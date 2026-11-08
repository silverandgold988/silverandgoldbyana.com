// Utilidades compartidas: Canva OAuth/API y almacenamiento en Netlify Blobs.
import { getStore } from "@netlify/blobs";

export const CANVA_API = "https://api.canva.com/rest/v1";

export interface CatalogDef {
  id: string;
  canva_design_id: string;
  export_width: number;
  thumb_width: number;
  // Datos de presentación: se usan para crear la entrada del manifest la primera vez
  // que se publica un catálogo nuevo (los catálogos ya publicados conservan su texto).
  title: string;
  subtitle?: string;
  note?: string;
  price?: string;
  orientation: "portrait" | "landscape";
  skip_first_page?: boolean;
}

// Para agregar un catálogo nuevo basta con añadirlo aquí (ID del diseño de Canva, el que
// empieza por "D") y desplegar: la sincronización programada lo exporta y lo publica sola.
export const CATALOGS: CatalogDef[] = [
  { id: "lentes", canva_design_id: "DAHYqsMGZUE", export_width: 1200, thumb_width: 620,
    title: "Lentes", subtitle: "Más de 100 modelos de lentes de sol",
    note: "Cada modelo tiene su número. Escríbenos con el número para pedirlo.", orientation: "portrait" },
  { id: "gorras", canva_design_id: "DAHYqj18Am0", export_width: 1200, thumb_width: 620,
    title: "Gorras", subtitle: "Gorras bordadas con frases", price: "$25 c/u",
    note: "72 diseños numerados. Escríbenos con el número para pedirla.", orientation: "portrait" },
  { id: "alo", canva_design_id: "DAHYqt2xU-E", export_width: 1600, thumb_width: 620,
    title: "Alo", subtitle: "Sets deportivos, gorras, viseras, headbands y sneakers",
    note: "Pregúntanos por tallas y colores disponibles.", orientation: "landscape", skip_first_page: true },
  { id: "sweaters", canva_design_id: "DAHaR_O95zg", export_width: 1600, thumb_width: 620,
    title: "Sweaters y Franelas", subtitle: "Sweaters y franelas con frases",
    note: "Pregúntanos por tallas y colores disponibles.", orientation: "landscape", skip_first_page: true },
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
