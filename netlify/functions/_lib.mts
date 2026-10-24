// Utilidades compartidas: Canva OAuth/API y almacenamiento en Netlify Blobs.
import { getStore } from "@netlify/blobs";

export const CANVA_API = "https://api.canva.com/rest/v1";

export interface CatalogDef {
  id: string;
  canva_design_id: string;
  export_width: number;
  thumb_width: number;
}

export const CATALOGS: CatalogDef[] = [
  { id: "lentes", canva_design_id: "DAHYqsMGZUE", export_width: 1200, thumb_width: 620 },
  { id: "gorras", canva_design_id: "DAHYqj18Am0", export_width: 1200, thumb_width: 620 },
  { id: "alo",    canva_design_id: "DAHYqt2xU-E", export_width: 1600, thumb_width: 620 },
];

export const sync = () => getStore({ name: "canva-sync", consistency: "strong" });
export const catalog = () => getStore({ name: "catalog", consistency: "strong" });

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function basicAuth() {
  const id = process.env.CANVA_CLIENT_ID!;
  const secret = process.env.CANVA_CLIENT_SECRET!;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function exchangeToken(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${CANVA_API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!r.ok) throw new Error(`Canva token ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.json();
  const tokens: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in ?? 14400) * 1000,
  };
  await sync().setJSON("tokens", tokens);
  return tokens;
}

export async function accessToken(): Promise<string> {
  const t = (await sync().get("tokens", { type: "json" })) as Tokens | null;
  if (!t) throw new Error("Canva no autorizado todavía (falta ejecutar canva-auth).");
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  // El refresh token es de un solo uso: exchangeToken guarda el nuevo de inmediato.
  const n = await exchangeToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  return n.access_token;
}

export async function canva(path: string, init: RequestInit = {}): Promise<any> {
  const tok = await accessToken();
  const r = await fetch(`${CANVA_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Canva API ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export function log(...a: unknown[]) {
  console.log(new Date().toISOString(), ...a);
}
