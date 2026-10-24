// Sirve /catalog/* desde Netlify Blobs: manifest.json, manifest.js e imágenes.
import type { Context } from "@netlify/functions";
import { catalog } from "./_lib.mts";

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  // Ruta tanto /catalog/x como /.netlify/functions/catalog/x
  const key = decodeURIComponent(url.pathname.replace(/^\/(\.netlify\/functions\/)?catalog\//, ""));
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const store = catalog();

  if (key === "manifest.json" || key === "manifest.js") {
    const m = await store.get("manifest.json", { type: "json" });
    if (!m) return new Response("Not found", { status: 404 });
    const body = key === "manifest.js" ? `window.CATALOG_MANIFEST = ${JSON.stringify(m)};\n` : JSON.stringify(m);
    return new Response(body, {
      headers: {
        "Content-Type": key === "manifest.js" ? "application/javascript; charset=utf-8" : "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, s-maxage=300",
      },
    });
  }

  const blob = await store.get(key, { type: "arrayBuffer" });
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(blob, {
    headers: {
      "Content-Type": key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : "application/octet-stream",
      // Las rutas llevan versión (vXXXX), así que pueden cachearse largo tiempo.
      "Cache-Control": "public, max-age=86400",
      "Netlify-CDN-Cache-Control": "public, s-maxage=31536000, immutable",
    },
  });
};

export const config = { path: "/.netlify/functions/catalog/*" };
