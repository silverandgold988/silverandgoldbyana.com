#!/usr/bin/env python3
"""
Sincroniza los catálogos de Canva con el sitio web.

Flujo:
  1. Lee sync/config.json (diseños de Canva a vigilar + datos de marca).
  2. Para cada diseño consulta la API de Canva; si cambió desde la última vez,
     lo exporta a JPG (todas las páginas) y descarga las imágenes a catalog/<id>/.
  3. Regenera catalog/manifest.json (lista de páginas + fecha de actualización).
  4. Sube por FTP(S) a GoDaddy solo lo que cambió.

Uso:
  python3 canva_sync.py            # sincroniza si hay cambios
  python3 canva_sync.py --force    # re-exporta todo aunque no haya cambios
  python3 canva_sync.py --no-upload  # solo genera localmente

Variables de entorno (archivo sync/.env):
  CANVA_CLIENT_ID, CANVA_CLIENT_SECRET   -> integración creada en canva.com/developers
  FTP_HOST, FTP_USER, FTP_PASS, FTP_DIR  -> hosting GoDaddy (FTP_DIR ej. /public_html)
El refresh token se guarda en sync/.tokens.json (lo crea auth.py la primera vez).
"""
import base64, json, os, sys, time, ftplib, ssl, hashlib
from pathlib import Path
from urllib import request, parse, error

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
CATALOG_DIR = SITE / "catalog"
STATE_FILE = HERE / ".state.json"
TOKEN_FILE = HERE / ".tokens.json"
API = "https://api.canva.com/rest/v1"

FORCE = "--force" in sys.argv
NO_UPLOAD = "--no-upload" in sys.argv


def load_env():
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


# ---------- Canva auth ----------
def get_access_token():
    tokens = json.loads(TOKEN_FILE.read_text())
    if tokens.get("expires_at", 0) - 60 > time.time():
        return tokens["access_token"]
    cid, sec = os.environ["CANVA_CLIENT_ID"], os.environ["CANVA_CLIENT_SECRET"]
    basic = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    data = parse.urlencode({"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]}).encode()
    req = request.Request(f"{API}/oauth/token", data=data, method="POST",
                          headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"})
    with request.urlopen(req, timeout=30) as r:
        t = json.load(r)
    t["expires_at"] = time.time() + t.get("expires_in", 14400)
    TOKEN_FILE.write_text(json.dumps(t, indent=2))  # el refresh token rota: guardar siempre
    return t["access_token"]


def api(method, path, body=None):
    tok = get_access_token()
    data = json.dumps(body).encode() if body is not None else None
    req = request.Request(f"{API}{path}", data=data, method=method,
                          headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(5 * (attempt + 1)); continue
            raise RuntimeError(f"Canva API {e.code}: {e.read().decode()[:300]}")


def export_design(design_id, width):
    job = api("POST", "/exports", {"design_id": design_id, "format": {"type": "jpg", "quality": 85, "width": width}})["job"]
    while job["status"] == "in_progress":
        time.sleep(3)
        job = api("GET", f"/exports/{job['id']}")["job"]
    if job["status"] != "success":
        raise RuntimeError(f"Export falló para {design_id}: {job}")
    return job["urls"]


def download(url, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with request.urlopen(url, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())


# ---------- FTP ----------
class Uploader:
    def __init__(self):
        self.ftp = ftplib.FTP_TLS(context=ssl.create_default_context()) if os.environ.get("FTP_TLS", "1") == "1" else ftplib.FTP()
        self.ftp.connect(os.environ["FTP_HOST"], int(os.environ.get("FTP_PORT", "21")), timeout=60)
        self.ftp.login(os.environ["FTP_USER"], os.environ["FTP_PASS"])
        if isinstance(self.ftp, ftplib.FTP_TLS):
            self.ftp.prot_p()
        self.root = os.environ.get("FTP_DIR", "/public_html").rstrip("/")
        self.ftp.cwd(self.root)
        self._dirs = set()

    def _ensure_dir(self, rel):
        parts = [p for p in rel.split("/") if p]
        cur = self.root
        for p in parts:
            cur = f"{cur}/{p}"
            if cur in self._dirs: continue
            try: self.ftp.mkd(cur)
            except ftplib.error_perm: pass
            self._dirs.add(cur)

    def put(self, local: Path, rel: str):
        self._ensure_dir(os.path.dirname(rel))
        with open(local, "rb") as f:
            self.ftp.storbinary(f"STOR {self.root}/{rel}", f)

    def delete(self, rel: str):
        try: self.ftp.delete(f"{self.root}/{rel}")
        except ftplib.error_perm: pass

    def close(self):
        try: self.ftp.quit()
        except Exception: pass


def make_thumb(src: Path, dest: Path, width=620):
    try:
        from PIL import Image
    except ImportError:
        return  # sin Pillow la página usa las imágenes completas
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
    im.save(dest, quality=82, optimize=True)


def file_hash(p: Path):
    return hashlib.md5(p.read_bytes()).hexdigest()


# ---------- main ----------
def main():
    load_env()
    config = json.loads((HERE / "config.json").read_text())
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {"designs": {}, "uploaded": {}}
    changed_any = False
    manifest_catalogs = []

    for cat in config["catalogs"]:
        did = cat["canva_design_id"]
        design = api("GET", f"/designs/{did}")["design"]
        updated_at = design.get("updated_at", 0)
        page_count = design.get("page_count", 0)
        prev = state["designs"].get(did, {})
        folder = CATALOG_DIR / cat["id"]
        existing = sorted(folder.glob("page-*.jpg")) if folder.exists() else []

        if FORCE or prev.get("updated_at") != updated_at or len(existing) != page_count:
            log(f"[{cat['id']}] cambios detectados en Canva → exportando {page_count} páginas…")
            urls = export_design(did, cat.get("export_width", 1400))
            for old in existing: old.unlink()
            for old in folder.glob("thumbs/*.jpg"): old.unlink()
            for i, u in enumerate(urls, 1):
                dest = folder / f"page-{i:02d}.jpg"
                download(u, dest)
                make_thumb(dest, folder / "thumbs" / dest.name)
            state["designs"][did] = {"updated_at": updated_at, "page_count": len(urls), "synced": time.time()}
            changed_any = True
            log(f"[{cat['id']}] {len(urls)} páginas descargadas")
        else:
            log(f"[{cat['id']}] sin cambios")

        pages = sorted(p.name for p in folder.glob("page-*.jpg"))
        entry = {k: v for k, v in cat.items() if k not in ("export_width",)}
        entry["pages"] = [f"{cat['id']}/{p}" for p in pages]
        entry["thumbs"] = (folder / "thumbs").exists()
        manifest_catalogs.append(entry)

    manifest_path = CATALOG_DIR / "manifest.json"
    old_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if changed_any or not old_manifest else old_manifest.get("updated"),
        "brand": config["brand"],
        "catalogs": manifest_catalogs,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    (CATALOG_DIR / "manifest.js").write_text("window.CATALOG_MANIFEST = " + json.dumps(manifest, ensure_ascii=False) + ";\n")
    STATE_FILE.write_text(json.dumps(state, indent=2))

    if NO_UPLOAD:
        log("generado localmente (sin subir)"); return

    # Subir solo archivos nuevos o modificados (por hash), y borrar los que ya no existen
    to_upload = []
    current = {}
    for p in SITE.rglob("*"):
        if p.is_dir(): continue
        rel = p.relative_to(SITE).as_posix()
        if rel.startswith("sync/") or rel.startswith(".") or "/." in rel or rel.endswith((".py", ".md")): continue
        h = file_hash(p); current[rel] = h
        if state["uploaded"].get(rel) != h: to_upload.append((p, rel))
    removed = [rel for rel in state["uploaded"] if rel not in current]

    if not to_upload and not removed:
        log("nada que subir"); return
    up = Uploader()
    for p, rel in to_upload:
        up.put(p, rel); state["uploaded"][rel] = current[rel]; log("↑", rel)
    for rel in removed:
        up.delete(rel); state["uploaded"].pop(rel, None); log("✗", rel)
    up.close()
    STATE_FILE.write_text(json.dumps(state, indent=2))
    log(f"listo: {len(to_upload)} subidos, {len(removed)} eliminados")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("ERROR:", e); sys.exit(1)
