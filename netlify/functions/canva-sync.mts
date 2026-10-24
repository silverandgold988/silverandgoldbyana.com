// Sincronización programada Canva → catálogo del sitio.
// Corre cada 5 minutos y avanza por pasos cortos (para no exceder el tiempo de una función):
//   1) Si hay un trabajo en curso, lo continúa (esperar export → descargar páginas → publicar).
//   2) Si no, revisa si algún diseño cambió en Canva y arranca un trabajo para el primero que cambió.
import type { Config } from "@netlify/functions";
import { purgeCache } from "@netlify/functions";
import { CATALOGS, canva, sync, catalog, log, type CatalogDef } from "./_lib.mts";

const PAGES_PER_RUN = 6;

interface DesignState { updated_at: number; page_count: number }
interface State { designs: Record<string, DesignState> }
interface Job {
  catalog_id: string;
  design_id: string;
  updated_at: number;
  page_count: number;
  version: string;
  full_export?: string;   // id del export job
  thumb_export?: string;
  full_urls?: string[];
  thumb_urls?: string[];
  downloaded: number;
  started: number;
}

export default async () => {
  const store = sync();
  const job = (await store.get("job", { type: "json" })) as Job | null;
  try {
    if (job) {
      await continueJob(job);
    } else {
      await checkForChanges();
    }
  } catch (e: any) {
    log("ERROR", e.message);
    // Si un trabajo lleva más de 2 horas atascado, se descarta para reintentar limpio.
    if (job && Date.now() - job.started > 2 * 3600_000) {
      await store.delete("job");
      log("trabajo descartado por tiempo", job.catalog_id);
    }
  }
  return new Response("ok");
};

async function checkForChanges() {
  const store = sync();
  const state = ((await store.get("state", { type: "json" })) as State | null) ?? { designs: {} };
  for (const cat of CATALOGS) {
    const d = (await canva(`/designs/${cat.canva_design_id}`)).design;
    const prev = state.designs[cat.canva_design_id];
    const changed = !prev || prev.updated_at !== d.updated_at || prev.page_count !== d.page_count;
    if (!changed) continue;
    log(`[${cat.id}] cambio detectado (updated_at ${prev?.updated_at} → ${d.updated_at}, páginas ${d.page_count})`);
    const full = await canva("/exports", { method: "POST", body: JSON.stringify({ design_id: cat.canva_design_id, format: { type: "jpg", quality: 85, width: cat.export_width } }) });
    const thumb = await canva("/exports", { method: "POST", body: JSON.stringify({ design_id: cat.canva_design_id, format: { type: "jpg", quality: 82, width: cat.thumb_width } }) });
    const job: Job = {
      catalog_id: cat.id, design_id: cat.canva_design_id, updated_at: d.updated_at, page_count: d.page_count,
      version: `v${d.updated_at}`, full_export: full.job.id, thumb_export: thumb.job.id, downloaded: 0, started: Date.now(),
    };
    await store.setJSON("job", job);
    return; // un catálogo por vez
  }
  log("sin cambios en Canva");
}

async function pollExport(id: string): Promise<string[] | null> {
  const j = (await canva(`/exports/${id}`)).job;
  if (j.status === "in_progress") return null;
  if (j.status !== "success") throw new Error(`export ${id} falló: ${JSON.stringify(j.error ?? j)}`);
  return j.urls as string[];
}

async function continueJob(job: Job) {
  const store = sync();
  const cat = CATALOGS.find(c => c.id === job.catalog_id)!;

  if (!job.full_urls) job.full_urls = (await pollExport(job.full_export!)) ?? undefined;
  if (!job.thumb_urls) job.thumb_urls = (await pollExport(job.thumb_export!)) ?? undefined;
  await store.setJSON("job", job);
  if (!job.full_urls || !job.thumb_urls) { log(`[${job.catalog_id}] export en progreso`); return; }

  const total = job.full_urls.length;
  const imgs = catalog();
  const end = Math.min(total, job.downloaded + PAGES_PER_RUN);
  for (let i = job.downloaded; i < end; i++) {
    const name = `page-${String(i + 1).padStart(2, "0")}.jpg`;
    const [f, t] = await Promise.all([fetch(job.full_urls[i]), fetch(job.thumb_urls[i])]);
    if (!f.ok || !t.ok) throw new Error(`descarga falló página ${i + 1}: ${f.status}/${t.status}`);
    await Promise.all([
      imgs.set(`${cat.id}/${job.version}/${name}`, await f.arrayBuffer()),
      imgs.set(`${cat.id}/${job.version}/thumbs/${name}`, await t.arrayBuffer()),
    ]);
    job.downloaded = i + 1;
    await store.setJSON("job", job);
  }
  log(`[${job.catalog_id}] descargadas ${job.downloaded}/${total}`);
  if (job.downloaded < total) return;

  await finalize(job, cat, total);
}

async function finalize(job: Job, cat: CatalogDef, total: number) {
  const store = sync();
  const imgs = catalog();
  const manifest = (await imgs.get("manifest.json", { type: "json" })) as any;
  const entry = manifest.catalogs.find((c: any) => c.id === cat.id);
  if (!entry) throw new Error(`catálogo ${cat.id} no está en el manifest`);
  entry.pages = Array.from({ length: total }, (_, i) => `${cat.id}/${job.version}/page-${String(i + 1).padStart(2, "0")}.jpg`);
  entry.thumbs = true;
  manifest.updated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await imgs.setJSON("manifest.json", manifest);

  const state = ((await store.get("state", { type: "json" })) as State | null) ?? { designs: {} };
  state.designs[job.design_id] = { updated_at: job.updated_at, page_count: job.page_count };
  await store.setJSON("state", state);
  await store.delete("job");

  // Borrar versiones anteriores de este catálogo
  const { blobs } = await imgs.list({ prefix: `${cat.id}/` });
  const old = blobs.filter(b => !b.key.startsWith(`${cat.id}/${job.version}/`));
  for (const b of old) await imgs.delete(b.key);

  try { await purgeCache(); } catch (e: any) { log("purgeCache:", e.message); }
  log(`[${cat.id}] publicado: ${total} páginas (${job.version}), ${old.length} archivos viejos eliminados`);
}

export const config: Config = {
  schedule: "*/5 * * * *",
};
