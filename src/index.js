// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
import { WorkflowEntrypoint } from "cloudflare:workers";
import HTML from "./ui.html";
import { faviconSvg } from "./bloom.js";
import FFWORKER from "./ffworker.js.txt";

const MB = 1024 * 1024;
const LIMITS = {
  imageBytes: 25 * MB,
  mediaBytes: 100 * MB, // Media Transformations input limit
  streamBytes: 200 * MB, // Stream basic direct upload limit
  maxDurationSeconds: 600,
};
const IMAGE_FORMATS = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };
const VIDEO_TARGETS = {
  mp4: { mode: "video", ext: "mp4", type: "video/mp4" },
  m4a: { mode: "audio", ext: "m4a", type: "audio/mp4" },
  jpg: { mode: "frame", ext: "jpg", type: "image/jpeg" },
  png: { mode: "frame", ext: "png", type: "image/png" },
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const err = (message, status = 400) => json({ error: message }, status);
const now = () => Date.now();
const today = () => new Date().toISOString().slice(0, 10);

async function ipHash(req) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + ":" + today()));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Daily quota counter in D1. Returns false when over limit.
async function takeQuota(env, subject, limit, units = 1) {
  const row = await env.DB.prepare(
    "INSERT INTO usage (day, subject, units) VALUES (?1, ?2, ?3) ON CONFLICT(day, subject) DO UPDATE SET units = units + ?3 RETURNING units"
  ).bind(today(), subject, units).first();
  return row.units <= limit;
}

async function verifyTurnstile(env, token, req) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  body.append("remoteip", req.headers.get("cf-connecting-ip") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = await r.json();
  return !!out.success;
}

const safeName = (name, ext) =>
  ((name || "file").replace(/\.[^.]+$/, "").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file") + "." + ext;

async function updateJob(env, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(", ");
  await env.DB.prepare(`UPDATE jobs SET ${sets}, updated_at = ?${keys.length + 2} WHERE id = ?1`)
    .bind(id, ...keys.map((k) => fields[k]), now())
    .run();
}

// Stream an unknown-length body into R2 using multipart upload (parts >= 5 MiB).
async function putStream(bucket, key, stream, contentType, contentDisposition) {
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType, contentDisposition } });
  const PART = 10 * MB;
  const parts = [];
  let buf = new Uint8Array(PART);
  let len = 0;
  let size = 0;
  const flush = async () => {
    parts.push(await upload.uploadPart(parts.length + 1, buf.slice(0, len)));
    len = 0;
  };
  try {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      let off = 0;
      while (off < value.byteLength) {
        const n = Math.min(PART - len, value.byteLength - off);
        buf.set(value.subarray(off, off + n), len);
        len += n;
        off += n;
        if (len === PART) await flush();
      }
    }
    if (len > 0 || parts.length === 0) await flush();
    await upload.complete(parts);
    return size;
  } catch (e) {
    await upload.abort().catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- Workflow
export class ConvertJob extends WorkflowEntrypoint {
  async run(event, step) {
    const { id } = event.payload;
    const env = this.env;
    const job = await step.do("load", async () => env.DB.prepare("SELECT * FROM jobs WHERE id = ?1").bind(id).first());
    if (!job) return { error: "missing job" };
    const opts = JSON.parse(job.options || "{}");
    const target = VIDEO_TARGETS[opts.target];
    const outName = safeName(job.input_name, target.ext);
    const disposition = `attachment; filename="${outName}"`;

    try {
      if (job.engine === "media") {
        await step.do("transform", { retries: { limit: 2, delay: "5 seconds" }, timeout: "10 minutes" }, async () => {
          await updateJob(env, id, { status: "processing", progress: 30, step: "Konvertiere mit Media Transformations" });
          const obj = await env.FILES.get(`in/${id}`);
          if (!obj) throw new Error("Eingabedatei fehlt");
          let t = env.MEDIA.input(obj.body);
          if (opts.width) t = t.transform({ width: opts.width, fit: "scale-down" });
          const out = { mode: target.mode };
          if (target.mode === "frame") {
            out.format = target.ext;
            out.time = opts.time || "0s";
          }
          if (target.mode === "video" && opts.mute) out.audio = false;
          const media = await t.output(out).media();
          const size = await putStream(env.FILES, `out/${id}`, media, target.type, disposition);
          await updateJob(env, id, { progress: 95, output_size: size });
        });
      } else {
        // Stream engine: wait for encode, generate download, copy to R2, delete from Stream.
        const video = () => env.STREAM.video(job.stream_uid);
        let ready = false;
        for (let i = 0; i < 180 && !ready; i++) {
          ready = await step.do(`encode-${i}`, async () => {
            const d = await video().details();
            const state = d.status?.state;
            if (state === "error") throw new Error("Stream: " + (d.status.errorReasonText || "Encoding fehlgeschlagen"));
            if (d.duration > LIMITS.maxDurationSeconds) throw new Error("Video ist länger als 10 Minuten");
            const pct = parseFloat(d.status?.pctComplete || "0") || 0;
            await updateJob(env, id, { status: "processing", progress: Math.round(10 + pct * 0.5), step: "Stream encodiert" });
            return !!d.readyToStream;
          });
          if (!ready) await step.sleep(`wait-encode-${i}`, "5 seconds");
        }
        if (!ready) throw new Error("Zeitüberschreitung beim Encodieren");

        const kind = target.mode === "audio" ? "audio" : "default";
        await step.do("generate-download", async () => {
          await video().downloads.generate(kind);
        });
        let url = null;
        for (let i = 0; i < 120 && !url; i++) {
          url = await step.do(`download-${i}`, async () => {
            const d = (await video().downloads.get())[kind];
            if (d?.status === "error") throw new Error("Stream: Download konnte nicht erzeugt werden");
            await updateJob(env, id, { progress: Math.round(60 + (d?.percentComplete || 0) * 0.25), step: "Erzeuge Datei" });
            return d?.status === "ready" ? d.url : null;
          });
          if (!url) await step.sleep(`wait-download-${i}`, "5 seconds");
        }
        if (!url) throw new Error("Zeitüberschreitung beim Download");

        await step.do("copy", { retries: { limit: 3, delay: "10 seconds" }, timeout: "10 minutes" }, async () => {
          await updateJob(env, id, { progress: 88, step: "Speichere Ergebnis" });
          const r = await fetch(url);
          if (!r.ok) throw new Error("Download von Stream fehlgeschlagen: " + r.status);
          const size = await putStream(env.FILES, `out/${id}`, r.body, target.type, disposition);
          await updateJob(env, id, { output_size: size });
        });
        await step.do("cleanup-stream", async () => {
          await video().delete().catch(() => {});
        });
      }

      await step.do("done", async () => {
        await env.FILES.delete(`in/${id}`);
        await updateJob(env, id, {
          status: "done", progress: 100, step: "Fertig",
          output_key: `out/${id}`, output_name: outName, output_type: target.type,
        });
      });
      return { ok: true };
    } catch (e) {
      await step.do("fail", async () => {
        await updateJob(env, id, { status: "error", error: String(e.message || e).slice(0, 300), step: "Fehler" });
        await env.FILES.delete(`in/${id}`);
        if (job.stream_uid) await env.STREAM.video(job.stream_uid).delete().catch(() => {});
      });
      return { ok: false };
    }
  }
}

// ---------------------------------------------------------------- HTTP
async function handleImage(req, env, url) {
  const ip = await ipHash(req);
  const { success } = await env.IMG_LIMIT.limit({ key: ip });
  if (!success) return err("Zu viele Anfragen, bitte kurz warten.", 429);
  const format = url.searchParams.get("format");
  if (!IMAGE_FORMATS[format]) return err("Unbekanntes Zielformat");
  const size = +req.headers.get("content-length") || 0;
  if (!size || size > LIMITS.imageBytes) return err("Bilder dürfen max. 25 MB groß sein", 413);
  if (!(await takeQuota(env, "img:" + ip, +env.IMAGE_DAILY_PER_IP))) return err("Tageslimit für Bilder erreicht", 429);
  if (!(await takeQuota(env, "img:global", +env.IMAGE_DAILY_GLOBAL))) return err("Globales Tageslimit erreicht, bitte morgen wieder", 429);

  const quality = Math.min(100, Math.max(1, +url.searchParams.get("quality") || 85));
  const width = +url.searchParams.get("width") || 0;
  try {
    let t = env.IMAGES.input(req.body);
    if (width > 0) t = t.transform({ width: Math.min(width, 12000), fit: "scale-down" });
    const out = await t.output({ format: IMAGE_FORMATS[format], quality, anim: format === "webp" ? undefined : false });
    const name = safeName(url.searchParams.get("name"), format === "jpeg" ? "jpg" : format);
    return out.response({
      headers: { "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    return err("Konvertierung fehlgeschlagen: " + (e.message || e), 422);
  }
}

async function createJob(req, env) {
  const ip = await ipHash(req);
  const { success } = await env.JOB_LIMIT.limit({ key: ip });
  if (!success) return err("Zu viele Jobs, bitte kurz warten.", 429);
  const body = await req.json().catch(() => ({}));
  const { name, size, type, target, width, mute, time, turnstile } = body;
  if (!VIDEO_TARGETS[target]) return err("Unbekanntes Zielformat");
  if (!(size > 0)) return err("Datei fehlt");
  if (!(await verifyTurnstile(env, turnstile, req))) return err("Bot-Check fehlgeschlagen, bitte neu laden.", 403);

  const isMp4 = /^video\/(mp4|quicktime)$/.test(type || "") || /\.(mp4|m4v)$/i.test(name || "");
  let engine;
  if (isMp4 && size <= LIMITS.mediaBytes) engine = "media";
  else if (size <= LIMITS.streamBytes && VIDEO_TARGETS[target].mode !== "frame") engine = "stream";
  else if (VIDEO_TARGETS[target].mode === "frame") return err("Standbilder gehen in der Cloud nur aus MP4 bis 100 MB. Nutze den lokalen Modus.");
  else return err("Cloud-Konvertierung bis 200 MB. Größere Dateien bitte lokal konvertieren.", 413);

  if (!(await takeQuota(env, "job:" + ip, +env.JOB_DAILY_PER_IP))) return err("Tageslimit für Videos erreicht", 429);
  if (!(await takeQuota(env, "job:global", +env.JOB_DAILY_GLOBAL))) return err("Globales Tageslimit erreicht, bitte morgen wieder", 429);

  const id = crypto.randomUUID();
  const options = JSON.stringify({ target, width: Math.min(+width || 0, 2000) || undefined, mute: !!mute, time: /^\d+(\.\d+)?s$/.test(time || "") ? time : undefined });
  let upload;
  let streamUid = null;
  if (engine === "media") {
    upload = { method: "PUT", url: `/api/jobs/${id}/upload` };
  } else {
    const du = await env.STREAM.createDirectUpload({
      maxDurationSeconds: LIMITS.maxDurationSeconds,
      meta: { name: "convert-" + id },
      creator: "convert",
    });
    streamUid = du.id;
    upload = { method: "POST", url: du.uploadURL, field: "file", then: `/api/jobs/${id}/start` };
  }
  await env.DB.prepare(
    "INSERT INTO jobs (id, kind, engine, status, progress, step, input_name, input_key, stream_uid, options, ip_hash, created_at, updated_at) VALUES (?1, 'video', ?2, 'uploading', 0, 'Upload', ?3, ?4, ?5, ?6, ?7, ?8, ?8)"
  ).bind(id, engine, (name || "video").slice(0, 200), `in/${id}`, streamUid, options, ip, now()).run();
  return json({ id, engine, upload });
}

async function getJob(env, id) {
  return env.DB.prepare("SELECT * FROM jobs WHERE id = ?1").bind(id).first();
}

async function startWorkflow(env, id) {
  await updateJob(env, id, { status: "queued", progress: 5, step: "In der Warteschlange" });
  await env.CONVERT_JOB.create({ id, params: { id } });
}

async function handleUpload(req, env, id) {
  const job = await getJob(env, id);
  if (!job || job.engine !== "media" || job.status !== "uploading") return err("Job nicht gefunden", 404);
  const size = +req.headers.get("content-length") || 0;
  if (!size || size > LIMITS.mediaBytes) return err("Datei zu groß", 413);
  await env.FILES.put(`in/${id}`, req.body, { httpMetadata: { contentType: req.headers.get("content-type") || "video/mp4" } });
  await startWorkflow(env, id);
  return json({ ok: true });
}

function publicJob(job) {
  return {
    id: job.id, engine: job.engine, status: job.status, progress: job.progress, step: job.step,
    error: job.error, outputName: job.output_name, outputSize: job.output_size,
    download: job.status === "done" ? `/api/jobs/${job.id}/download` : null,
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://cdn.jsdelivr.net blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net https://*.videodelivery.net https://*.cloudflarestream.com blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "frame-src https://challenges.cloudflare.com",
].join("; ");

// Favicon: the solid bloom from shiftbloom.studio (brand spec: < 32px uses the solid variant).
const FAVICON = faviconSvg();

// Brand fonts (Clash Display, General Sans, JetBrains Mono) are proxied through this
// Worker, so visitors never connect to Fontshare or Google directly.
const FONT_CSS = [
  // Fontshare returns only the first family per request, so one URL per family.
  "https://api.fontshare.com/v2/css?f[]=clash-display@400,600&display=swap",
  "https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap",
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
];
const FONT_HOSTS = { fs: "https://cdn.fontshare.com/", gs: "https://fonts.gstatic.com/" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function fontCss(ctx) {
  const cache = caches.default;
  const key = new Request("https://convert.internal/fonts.css?v=2");
  let res = await cache.match(key);
  if (res) return res;
  const parts = await Promise.all(FONT_CSS.map((u) => fetch(u, { headers: { "user-agent": UA } }).then((r) => (r.ok ? r.text() : ""))));
  const css = parts.join("\n").replace(/url\((['"]?)(?:https?:)?\/\/(cdn\.fontshare\.com|fonts\.gstatic\.com)\/([^'")]+)\1\)/g,
    (_, q, host, path) => `url(/fonts/${host.startsWith("cdn") ? "fs" : "gs"}/${path})`);
  res = new Response(css, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" } });
  if (css.length > 100) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function fontFile(kind, path) {
  const base = FONT_HOSTS[kind];
  if (!base || path.includes("..")) return err("Not found", 404);
  const r = await fetch(base + path, { headers: { "user-agent": UA }, cf: { cacheEverything: true, cacheTtl: 2592000 } });
  if (!r.ok) return err("Not found", 404);
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "font/woff2", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && (p === "/" || p === "/index.html")) {
    return new Response(HTML.replace("__SITEKEY__", env.TURNSTILE_SITEKEY), {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
    });
  }
  if (m === "GET" && p === "/ffworker.js")
    return new Response(FFWORKER, { headers: { "content-type": "text/javascript", "cache-control": "public, max-age=3600" } });
  if (m === "GET" && (p === "/favicon.svg" || p === "/favicon.ico"))
    return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=604800" } });
  if (m === "GET" && p === "/fonts.css") return fontCss(ctx);
  const fm = m === "GET" && p.match(/^\/fonts\/(fs|gs)\/(.+)$/);
  if (fm) return fontFile(fm[1], fm[2]);
  if (m === "GET" && p === "/api/health") return json({ ok: true });
  if (m === "POST" && p === "/api/image") return handleImage(req, env, url);
  if (m === "POST" && p === "/api/jobs") return createJob(req, env);

  const jm = p.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/(upload|start|download))?$/);
  if (jm) {
    const [, id, , action] = jm;
    if (m === "PUT" && action === "upload") return handleUpload(req, env, id);
    const job = await getJob(env, id);
    if (!job) return err("Job nicht gefunden", 404);
    if (m === "POST" && action === "start") {
      if (job.engine !== "stream" || job.status !== "uploading") return err("Ungültiger Status", 409);
      await startWorkflow(env, id);
      return json({ ok: true });
    }
    if (m === "GET" && !action) return json(publicJob(job), 200, { "cache-control": "no-store" });
    if (m === "GET" && action === "download") {
      if (job.status !== "done") return err("Noch nicht fertig", 409);
      const obj = await env.FILES.get(job.output_key);
      if (!obj) return err("Datei abgelaufen (Ergebnisse werden nach 24 h gelöscht)", 410);
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set("content-length", obj.size);
      h.set("cache-control", "private, no-store");
      return new Response(obj.body, { headers: h });
    }
  }
  return err("Not found", 404);
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      console.error(e);
      return err("Interner Fehler", 500);
    }
  },
  // Safety net: remove leftover Stream videos and old job rows.
  async scheduled(event, env, ctx) {
    const cutoff = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const vids = await env.STREAM.videos.list({ before: cutoff, limit: 100 }).catch(() => []);
    for (const v of vids) if (v.creator === "convert") await env.STREAM.video(v.id).delete().catch(() => {});
    await env.DB.prepare("DELETE FROM jobs WHERE created_at < ?1").bind(Date.now() - 2 * 86400 * 1000).run();
    await env.DB.prepare("DELETE FROM usage WHERE day < ?1").bind(new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10)).run();
  },
};
