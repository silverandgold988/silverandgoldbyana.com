// Autorización OAuth con Canva (una sola vez).
//   Iniciar:   https://silverandgoldbyana.com/.netlify/functions/canva-auth?start=1&key=<SETUP_KEY>
//   Callback:  Canva redirige aquí con ?code=...&state=...
import crypto from "node:crypto";
import type { Context } from "@netlify/functions";
import { exchangeToken, sync, canva } from "./_lib.mts";

const SCOPES = "design:meta:read design:content:read";

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/.netlify/functions/canva-auth`;
  const store = sync();

  if (url.searchParams.get("start")) {
    if (url.searchParams.get("key") !== process.env.SETUP_KEY) {
      return new Response("No autorizado", { status: 403 });
    }
    const verifier = crypto.randomBytes(64).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(24).toString("base64url");
    await store.setJSON("oauth", { verifier, state, created: Date.now() });
    const auth = new URL("https://www.canva.com/api/oauth/authorize");
    auth.search = new URLSearchParams({
      code_challenge: challenge,
      code_challenge_method: "s256",
      scope: SCOPES,
      response_type: "code",
      client_id: process.env.CANVA_CLIENT_ID!,
      state,
      redirect_uri: redirectUri,
    }).toString();
    return Response.redirect(auth.toString(), 302);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return new Response("Falta el código de autorización.", { status: 400 });
  const pending = (await store.get("oauth", { type: "json" })) as { verifier: string; state: string } | null;
  if (!pending || pending.state !== state) {
    return new Response("Estado inválido o expirado. Vuelve a iniciar la autorización.", { status: 400 });
  }
  try {
    await exchangeToken({ grant_type: "authorization_code", code, code_verifier: pending.verifier, redirect_uri: redirectUri });
    await store.delete("oauth");
    // Forzar una sincronización completa en la próxima corrida
    await store.delete("state");
    const me = await canva("/users/me").catch(() => null);
    const who = me?.team_user?.user_id ? " Usuario Canva conectado." : "";
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center">
       <h2>✅ Canva autorizado${who}</h2><p>La sincronización automática del catálogo ya está activa. Puedes cerrar esta pestaña.</p></body>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e: any) {
    return new Response(`Error al autorizar: ${e.message}`, { status: 500 });
  }
};
