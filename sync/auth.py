#!/usr/bin/env python3
"""
Autorización inicial con Canva (una sola vez, se ejecuta en el VPS o en tu Mac).
Genera sync/.tokens.json con el refresh token que luego usa canva_sync.py.

Requisitos previos en https://www.canva.com/developers/integrations:
  - Crear una integración (tipo "Private").
  - Scopes: design:meta:read, design:content:read
  - Redirect URL: http://127.0.0.1:8765/callback
  - Copiar Client ID y Client Secret a sync/.env

Uso:  python3 auth.py   → abre la URL que imprime, inicia sesión con la cuenta de Ana y autoriza.
"""
import base64, hashlib, json, os, secrets, time, webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib import request, parse

HERE = Path(__file__).resolve().parent
REDIRECT = "http://127.0.0.1:8765/callback"
SCOPES = "design:meta:read design:content:read"

for line in (HERE / ".env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"'))
CID, SEC = os.environ["CANVA_CLIENT_ID"], os.environ["CANVA_CLIENT_SECRET"]

verifier = secrets.token_urlsafe(64)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
state = secrets.token_urlsafe(16)
url = "https://www.canva.com/api/oauth/authorize?" + parse.urlencode({
    "code_challenge": challenge, "code_challenge_method": "s256", "scope": SCOPES,
    "response_type": "code", "client_id": CID, "state": state, "redirect_uri": REDIRECT})
print("\nAbre esta URL en el navegador (con la cuenta de Canva de Ana):\n\n" + url + "\n")
try: webbrowser.open(url)
except Exception: pass

code_holder = {}
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse.parse_qs(parse.urlparse(self.path).query)
        code_holder["code"] = q.get("code", [None])[0]
        self.send_response(200); self.end_headers()
        self.wfile.write("Listo, ya puedes cerrar esta pestaña.".encode())
    def log_message(self, *a): pass

srv = HTTPServer(("127.0.0.1", 8765), H)
srv.handle_request()
code = code_holder.get("code")
if not code:
    raise SystemExit("No llegó el código de autorización.")

basic = base64.b64encode(f"{CID}:{SEC}".encode()).decode()
data = parse.urlencode({"grant_type": "authorization_code", "code_verifier": verifier, "code": code, "redirect_uri": REDIRECT}).encode()
req = request.Request("https://api.canva.com/rest/v1/oauth/token", data=data, method="POST",
                      headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"})
with request.urlopen(req) as r:
    tok = json.load(r)
tok["expires_at"] = time.time() + tok.get("expires_in", 14400)
(HERE / ".tokens.json").write_text(json.dumps(tok, indent=2))
print("✔ Tokens guardados en sync/.tokens.json")
