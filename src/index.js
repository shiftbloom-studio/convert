// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
import { WorkflowEntrypoint } from "cloudflare:workers";
import HTML from "./ui.html";
import { faviconSvg } from "./bloom.js";
import FFWORKER from "./ffworker.js.txt";
import OG from "./og.png";
import { HOME, FAQ, PAGES, REPO } from "./pages.js";
import { LEGAL, legalPage } from "./legal.js";

const MB = 1024 * 1024;
const LIMITS = {
  imageBytes: 20 * MB, // Images binding input limit
  mediaBytes: 100 * MB, // Media Transformations input limit
  streamBytes: 200 * MB, // Stream basic direct upload limit
  maxDurationSeconds: 600,
};
const IMAGE_PIXELS = 50e6; // decompression bombs: refuse anything larger before decoding it
const IMAGE_SIDE = 12000;
const SESSION_TTL = 20 * 60;
const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ts|mts|m2ts|ogv|vob)$/i;
const IMAGE_FORMATS = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif" };
const VIDEO_TARGETS = {
  mp4: { mode: "video", ext: "mp4", type: "video/mp4" },
  m4a: { mode: "audio", ext: "m4a", type: "audio/mp4" },
  jpg: { mode: "frame", ext: "jpg", type: "image/jpeg" },
  png: { mode: "frame", ext: "png", type: "image/png" },
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const err = (message, status = 400, detail) => json({ error: message, detail }, status);
const now = () => Date.now();
const QUOTA_MSG = "Cloudflare is done for today on this connection. Your browser can still convert files, or come back tomorrow.";
const today = () => new Date().toISOString().slice(0, 10);

const enc = (v) => new TextEncoder().encode(v);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const clientIp = (req) => req.headers.get("cf-connecting-ip") || "unknown";

// HMAC keys are derived from the Turnstile secret, so a hashed IP can't be reversed by
// hashing every address without it. One key per purpose.
const hmacKeys = new Map();
async function hmac(env, label, msg) {
  const id = label + ":" + (env.TURNSTILE_SECRET || "dev");
  if (!hmacKeys.has(id))
    hmacKeys.set(id, crypto.subtle.digest("SHA-256", enc(id)).then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])));
  return hex(await crypto.subtle.sign("HMAC", await hmacKeys.get(id), enc(msg)));
}

// Daily keyed hash of the connection: used for rate limits and quotas instead of the IP.
async function ipHash(req, env) {
  return (await hmac(env, "ip", clientIp(req) + ":" + today())).slice(0, 24);
}

// Browsers send Origin on every POST and PUT made by fetch or XHR. Anything else is a script.
function sameOrigin(req, url) {
  const o = req.headers.get("origin");
  if (o) return o === url.origin;
  return req.headers.get("sec-fetch-site") === "same-origin";
}

// Short-lived key for /api/image after one Turnstile check, bound to the connection.
async function sessionToken(env, req, exp) {
  return exp + "." + (await hmac(env, "session", clientIp(req) + ":" + exp)).slice(0, 32);
}
async function checkSession(req, env) {
  const t = req.headers.get("x-convert-session") || "";
  const exp = +t.split(".")[0];
  const nowS = now() / 1000;
  if (!(exp > nowS && exp <= nowS + SESSION_TTL + 60)) return false;
  const want = enc(await sessionToken(env, req, exp));
  const got = enc(t);
  return want.byteLength === got.byteLength && crypto.subtle.timingSafeEqual(want, got);
}

// Daily quota counter in D1. Returns false when over limit.
async function takeQuota(env, subject, limit, units = 1) {
  const row = await env.DB.prepare(
    "INSERT INTO usage (day, subject, units) VALUES (?1, ?2, ?3) ON CONFLICT(day, subject) DO UPDATE SET units = units + ?3 RETURNING units"
  ).bind(today(), subject, units).first();
  return row.units <= limit;
}

async function verifyTurnstile(env, token, req, url) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  body.append("remoteip", req.headers.get("cf-connecting-ip") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const out = await r.json().catch(() => ({}));
  if (!out.success) return false;
  // Test keys answer for any host and action; real widgets must match this site.
  if (/^\dx0000/.test(env.TURNSTILE_SITEKEY || "")) return true;
  return out.hostname === url.hostname && out.action === "convert";
}

// Magic bytes of the image formats Cloudflare Images reads. SVG and anything else is refused.
const at = (b, off, str) => [...str].every((c, i) => b[off + i] === c.charCodeAt(0));
const brand = (b) => (at(b, 4, "ftyp") ? String.fromCharCode(...b.subarray(8, 12)) : null);
function sniffImage(b) {
  if (b.length < 12) return null;
  if (at(b, 0, "\x89PNG\r\n\x1a\n")) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (at(b, 0, "GIF87a") || at(b, 0, "GIF89a")) return "gif";
  if (at(b, 0, "RIFF") && at(b, 8, "WEBP")) return "webp";
  const br = brand(b);
  if (/^(avif|avis)$/.test(br)) return "avif";
  if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(br)) return "heic";
  return null;
}
// An MP4 starts with an ftyp box whose brand isn't one of the still-image brands.
const isMp4Head = (b) => { const br = brand(b); return !!br && !/^(avif|avis|heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(br); };

async function readLimited(body, max) {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// Results are only ever downloads: never rendered, sniffed or framed by the browser.
const FILE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-store", "cross-origin-resource-policy": "same-origin" };

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
          await updateJob(env, id, { status: "processing", progress: 30, step: "Cloudflare is converting" });
          const obj = await env.FILES.get(`in/${id}`);
          if (!obj) throw new Error("input file missing");
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
            if (state === "error") throw new Error("Stream: " + (d.status.errorReasonText || "encoding failed"));
            if (d.duration > LIMITS.maxDurationSeconds) throw new Error("too-long: " + d.duration);
            const pct = parseFloat(d.status?.pctComplete || "0") || 0;
            await updateJob(env, id, { status: "processing", progress: Math.round(10 + pct * 0.5), step: "Cloudflare is encoding" });
            return !!d.readyToStream;
          });
          if (!ready) await step.sleep(`wait-encode-${i}`, "5 seconds");
        }
        if (!ready) throw new Error("timeout: encoding");

        const kind = target.mode === "audio" ? "audio" : "default";
        await step.do("generate-download", async () => {
          await video().downloads.generate(kind);
        });
        let url = null;
        for (let i = 0; i < 120 && !url; i++) {
          url = await step.do(`download-${i}`, async () => {
            const d = (await video().downloads.get())[kind];
            if (d?.status === "error") throw new Error("Stream: download could not be generated");
            await updateJob(env, id, { progress: Math.round(60 + (d?.percentComplete || 0) * 0.25), step: "Building the file" });
            return d?.status === "ready" ? d.url : null;
          });
          if (!url) await step.sleep(`wait-download-${i}`, "5 seconds");
        }
        if (!url) throw new Error("timeout: download");

        await step.do("copy", { retries: { limit: 3, delay: "10 seconds" }, timeout: "10 minutes" }, async () => {
          await updateJob(env, id, { progress: 88, step: "Saving the result" });
          const r = await fetch(url);
          if (!r.ok) throw new Error("Stream download failed: " + r.status);
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
          status: "done", progress: 100, step: "Done",
          output_key: `out/${id}`, output_name: outName, output_type: target.type,
        });
      });
      return { ok: true };
    } catch (e) {
      await step.do("fail", async () => {
        // Stored as "<message for people>\n<raw detail>"; publicJob splits it again.
        const raw = String(e.message || e).slice(0, 300);
        const msg = raw.startsWith("too-long")
          ? "This video is longer than 10 minutes and Cloudflare stops at 10. Pick an in-browser format instead. It's slower but has no time limit."
          : raw.startsWith("timeout")
            ? "This is taking longer than it should. Try again in a few minutes, or convert it in your browser."
            : "Something went wrong. Try again in a moment.";
        await updateJob(env, id, { status: "error", error: msg + "\n" + raw, step: "Failed" });
        await env.FILES.delete(`in/${id}`);
        if (job.stream_uid) await env.STREAM.video(job.stream_uid).delete().catch(() => {});
      });
      return { ok: false };
    }
  }
}

// ---------------------------------------------------------------- HTTP
async function createSession(req, env, url) {
  if (!sameOrigin(req, url)) return err("This only works from the convert page.", 403);
  const ip = await ipHash(req, env);
  const { success } = await env.IMG_LIMIT.limit({ key: "s:" + ip });
  if (!success) return err("Too many requests. Wait a minute and try again.", 429);
  const body = await req.json().catch(() => ({}));
  if (!(await verifyTurnstile(env, body.turnstile, req, url))) return err("The bot check failed. Reload the page and try again.", 403);
  const expires = Math.floor(now() / 1000) + SESSION_TTL;
  return json({ token: await sessionToken(env, req, expires), expires }, 200, { "cache-control": "no-store" });
}

async function handleImage(req, env, url) {
  if (!sameOrigin(req, url)) return err("This only works from the convert page.", 403);
  const ip = await ipHash(req, env);
  const { success } = await env.IMG_LIMIT.limit({ key: ip });
  if (!success) return err("Too many requests. Wait a minute and try again.", 429);
  if (!(await checkSession(req, env))) return json({ error: "The bot check expired. Try again.", code: "session" }, 401);
  const format = url.searchParams.get("format");
  if (!IMAGE_FORMATS[format]) return err("Unknown target format.");
  const size = +req.headers.get("content-length") || 0;
  if (!size || size > LIMITS.imageBytes) return err(`This image is ${(size / MB).toFixed(1)} MB. Cloudflare takes up to 20 MB.`, 413);
  const bytes = await readLimited(req.body, LIMITS.imageBytes);
  if (!bytes) return err("This image is over 20 MB. Cloudflare takes up to 20 MB.", 413);
  if (!sniffImage(bytes)) return err("This doesn't look like an image convert can read. Try PNG, JPG, WebP, GIF, AVIF or HEIC.", 415);
  if (!(await takeQuota(env, "img:" + ip, +env.IMAGE_DAILY_PER_IP))) return err(QUOTA_MSG, 429);
  if (!(await takeQuota(env, "img:global", +env.IMAGE_DAILY_GLOBAL))) return err(QUOTA_MSG, 429);

  const quality = Math.min(100, Math.max(1, +url.searchParams.get("quality") || 85));
  const width = +url.searchParams.get("width") || 0;
  const stream = () => new Response(bytes).body;
  let info;
  try {
    info = await env.IMAGES.info(stream());
  } catch (e) {
    return err("This image is damaged or not really an image.", 415, String(e.message || e));
  }
  if (!(info.width > 0 && info.height > 0)) return err("This image is damaged or not really an image.", 415);
  if (info.width * info.height > IMAGE_PIXELS || info.width > IMAGE_SIDE || info.height > IMAGE_SIDE)
    return err(`This image is ${info.width} × ${info.height} pixels. Cloudflare takes up to 50 megapixels and 12,000 pixels per side.`, 413);
  try {
    let t = env.IMAGES.input(stream());
    if (width > 0) t = t.transform({ width: Math.min(width, IMAGE_SIDE), fit: "scale-down" });
    const out = await t.output({ format: IMAGE_FORMATS[format], quality, anim: format === "webp" ? undefined : false });
    const name = "image." + (format === "jpeg" ? "jpg" : format);
    return out.response({
      headers: { ...FILE_HEADERS, "content-type": IMAGE_FORMATS[format], "content-disposition": `attachment; filename="${name}"` },
    });
  } catch (e) {
    return err("Something went wrong. Try again in a moment.", 422, String(e.message || e));
  }
}

async function createJob(req, env, url) {
  if (!sameOrigin(req, url)) return err("This only works from the convert page.", 403);
  const ip = await ipHash(req, env);
  const { success } = await env.JOB_LIMIT.limit({ key: ip });
  if (!success) return err("Too many requests. Wait a minute and try again.", 429);
  const body = await req.json().catch(() => ({}));
  const { name, size, type, target, width, mute, time, turnstile } = body;
  if (!VIDEO_TARGETS[target]) return err("Unknown target format.");
  if (!(size > 0)) return err("The file is missing.");
  if (!/^video\//.test(type || "") && !VIDEO_EXT.test(name || "")) return err("Cloudflare only takes videos here. Your browser can convert this file.", 415);
  if (!(await verifyTurnstile(env, turnstile, req, url))) return err("The bot check failed. Reload the page and try again.", 403);

  // MOV usually carries HEVC, which only Stream reads reliably, so only real MP4 takes the fast path.
  const isMp4 = /^video\/mp4$/.test(type || "") || (!type && /\.(mp4|m4v)$/i.test(name || ""));
  let engine;
  if (isMp4 && size <= LIMITS.mediaBytes) engine = "media";
  else if (size <= LIMITS.streamBytes && VIDEO_TARGETS[target].mode !== "frame") engine = "stream";
  else if (VIDEO_TARGETS[target].mode === "frame") return err("Cloudflare only takes still frames from MP4s up to 100 MB. Your browser can do it with any video.");
  else return err(`This video is ${(size / MB).toFixed(1)} MB. Cloudflare takes up to 200 MB.`, 413);

  if (!(await takeQuota(env, "job:" + ip, +env.JOB_DAILY_PER_IP))) return err(QUOTA_MSG, 429);
  if (!(await takeQuota(env, "job:global", +env.JOB_DAILY_GLOBAL))) return err(QUOTA_MSG, 429);

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
    "INSERT INTO jobs (id, kind, engine, status, progress, step, input_name, input_key, stream_uid, options, ip_hash, created_at, updated_at) VALUES (?1, 'video', ?2, 'uploading', 0, 'Uploading', ?3, ?4, ?5, ?6, ?7, ?8, ?8)"
  ).bind(id, engine, String(name || "video").slice(0, 200), `in/${id}`, streamUid, options, ip, now()).run();
  return json({ id, engine, upload });
}

async function getJob(env, id) {
  return env.DB.prepare("SELECT * FROM jobs WHERE id = ?1").bind(id).first();
}

async function startWorkflow(env, id) {
  await updateJob(env, id, { status: "queued", progress: 5, step: "Queued" });
  await env.CONVERT_JOB.create({ id, params: { id } });
}

async function handleUpload(req, env, id, url) {
  if (!sameOrigin(req, url)) return err("This only works from the convert page.", 403);
  const job = await getJob(env, id);
  if (!job || job.engine !== "media" || job.status !== "uploading") return err("Job not found.", 404);
  if (job.ip_hash !== (await ipHash(req, env))) return err("Job not found.", 404);
  const size = +req.headers.get("content-length") || 0;
  if (!size || size > LIMITS.mediaBytes) return err("This file is too big for the fast path.", 413);
  // Check the first bytes before anything reaches storage, then stream the rest through.
  const reader = req.body.getReader();
  let head = new Uint8Array(0);
  while (head.byteLength < 12) {
    const { done, value } = await reader.read();
    if (done) break;
    const next = new Uint8Array(head.byteLength + value.byteLength);
    next.set(head);
    next.set(value, head.byteLength);
    head = next;
  }
  if (!isMp4Head(head)) {
    await reader.cancel().catch(() => {});
    await updateJob(env, id, { status: "error", error: "This file isn't an MP4.\nmagic bytes", step: "Failed" });
    return err("This file isn't an MP4. Pick an in-browser format, or rename it to what it really is.", 415);
  }
  const { readable, writable } = new FixedLengthStream(size);
  const pump = (async () => {
    const w = writable.getWriter();
    await w.write(head);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await w.write(value);
    }
    await w.close();
  })();
  await Promise.all([env.FILES.put(`in/${id}`, readable, { httpMetadata: { contentType: "video/mp4" } }), pump]);
  await startWorkflow(env, id);
  return json({ ok: true });
}

function publicJob(job) {
  return {
    id: job.id, engine: job.engine, status: job.status, progress: job.progress, step: job.step,
    error: job.error ? job.error.split("\n")[0] : null, detail: job.error ? job.error.split("\n").slice(1).join("\n") : null, outputName: job.output_name, outputSize: job.output_size,
    download: job.status === "done" ? `/api/jobs/${job.id}/download` : null,
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.videodelivery.net https://*.cloudflarestream.com blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// ffmpeg.wasm core, fetched once from npm's CDN and served from here, so visitors never
// connect to a third party. Pinned version; the cache keeps it at the edge.
const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/";
async function vendor(file) {
  const r = await fetch(FFMPEG_CORE + file, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
  if (!r.ok) return err("Not found", 404);
  return new Response(r.body, {
    headers: {
      "content-type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

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
  const key = new Request("https://convert.internal/fonts.css?v=3");
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

// ---------------------------------------------------------------- Pages
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ldJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const BY_SLUG = Object.fromEntries(PAGES.map((p) => [p.slug, p]));
const fill = (tpl, map) => tpl.replace(/__([A-Z0-9]+)__/g, (m, k) => (k in map ? map[k] : m));
const faqText = (a, env) => a.replace("__IMG_DAY__", env.IMAGE_DAILY_PER_IP).replace("__JOB_DAY__", env.JOB_DAILY_PER_IP);

function app(origin) {
  return {
    "@type": "WebApplication",
    "@id": origin + "/#app",
    name: "convert.",
    url: origin + "/",
    description: HOME.desc,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    featureList: PAGES.map((p) => p.link).concat(["Still frames from video", "Remove audio from video"]),
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    sameAs: [REPO],
    publisher: { "@type": "Organization", "@id": "https://shiftbloom.studio/#org", name: "shiftbloom studio", url: "https://shiftbloom.studio" },
  };
}

function renderPage(page, env, origin) {
  const p = page || HOME;
  const url = origin + "/" + p.slug;
  const graph = [app(origin)];
  if (page) {
    graph.push({
      "@type": "HowTo",
      name: p.h1.replace(/\.$/, ""),
      description: p.desc,
      totalTime: "PT1M",
      step: [
        { "@type": "HowToStep", name: "Add the file", text: "Drop the file on the page or pick it from a folder." },
        { "@type": "HowToStep", name: "Check the format", text: `The target is already set to ${p.example.to.toUpperCase()}. Change it or switch between Cloudflare and your browser if you like.` },
        { "@type": "HowToStep", name: "Convert and download", text: "Press Convert, wait for the progress line to fill and download the result." },
      ],
    });
  }
  // Every page shows the FAQ block, so every page describes it.
  graph.push({
    "@type": "FAQPage",
    "@id": url + "#faq",
    mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: faqText(a, env) } })),
  });
  const ex = p.example;
  const example = `<div class="sample" aria-hidden="true"><div class="row"><div class="thumb">${esc(ex.name.split(".").pop().slice(0, 4))}</div><div style="min-width:0">
      <div class="name">${esc(ex.name)} <span>→</span> .${esc(ex.to)}</div>
      <div class="meta"><span class="num">${esc(ex.a)} → ${esc(ex.b)}</span><span class="tag ${ex.where}">${ex.where === "cloud" ? "cloudflare" : "browser"}</span></div>
      <div class="track"><div class="fill"></div><div class="dot"></div></div></div></div></div>`;
  const article = page
    ? `<section class="article"><h2>${esc(p.h2)}</h2>${p.body.map((t) => `<p>${esc(t)}</p>`).join("")}</section>`
    : "";
  const faq = FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(faqText(a, env))}</p></details>`).join("");
  const links = PAGES.map((x) => `<a href="/${x.slug}"${page && x.slug === page.slug ? ' aria-current="page"' : ""}>${esc(x.link)}</a>`).join("");
  return fill(HTML, {
    TITLE: esc(p.title),
    DESC: esc(p.desc),
    CANONICAL: esc(url),
    OGIMG: esc(origin + "/og.png"),
    JSONLD: ldJson({ "@context": "https://schema.org", "@graph": graph }),
    H1: esc(p.h1),
    LEAD: esc(p.lead),
    EXAMPLE: example,
    ARTICLE: article,
    FAQ: faq,
    LINKS: links,
    PRESET: ldJson(page ? page.preset : null),
    SITEKEY: esc(env.TURNSTILE_SITEKEY),
  });
}

const NOT_FOUND = (origin) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · convert.</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts.css">
<style>body{margin:0;font:16px/1.65 "General Sans",system-ui,sans-serif;color:#1A1216;background:#F6F1EE;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:560px}h1{font:600 clamp(32px,6vw,52px)/1.05 "Clash Display",system-ui,sans-serif;letter-spacing:-.03em;margin:18px 0 20px}h1 span{color:#FF2E52}
img{width:40px;height:40px}nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
a{font:500 13px/1 "JetBrains Mono",ui-monospace,monospace;color:#1A1216;padding:10px 14px;border-radius:999px;box-shadow:inset 0 0 0 1px #E2D8D5;text-decoration:none}
a:hover{box-shadow:inset 0 0 0 1px #C81040;color:#C81040}a.home{background:#FF2E52;color:#fff;box-shadow:none;font:600 15px/1 "General Sans",system-ui,sans-serif;padding:12px 22px}a.home:hover{background:#C81040;color:#fff}</style></head>
<body><main><img src="/favicon.svg" alt=""><h1>There's no page here<span>.</span></h1>
<a class="home" href="/">Back to convert</a>
<nav aria-label="Common conversions">${PAGES.map((p) => `<a href="/${p.slug}">${esc(p.link)}</a>`).join("")}</nav></main></body></html>`;

function sitemap(origin) {
  const day = "2026-11-25";
  const urls = ["", ...PAGES.map((p) => p.slug)]
    .map((s) => `<url><loc>${origin}/${s}</loc><lastmod>${day}</lastmod></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

// Search and AI answer engines are welcome; AI training crawlers are not
// (they are also blocked by a WAF rule at the edge).
const AI_TRAINING_CRAWLERS = [
  "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended",
  "Bytespider", "Amazonbot", "meta-externalagent", "cohere-ai", "MistralAI-Training", "Diffbot",
];
const robots = (origin) =>
  "User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: /\nDisallow: /api/\n\n" +
  AI_TRAINING_CRAWLERS.map((bot) => `User-agent: ${bot}`).join("\n") +
  `\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`;

const llms = (origin, env) => `# convert.

> A free, open source file converter. Images and short videos are converted on Cloudflare (Images, Stream, Media Transformations) and deleted after 24 hours. WebM, GIF and audio are converted by ffmpeg.wasm inside the visitor's browser and never uploaded.

- No account, no cookies. Licensed AGPL-3.0-or-later.
- Source and self-hosting guide: ${REPO}
- Made by shiftbloom studio: https://shiftbloom.studio

## Limits

- Cloudflare: images up to 20 MB, videos up to 200 MB and 10 minutes.
- Daily allowance per connection: ${env.IMAGE_DAILY_PER_IP} images and ${env.JOB_DAILY_PER_IP} videos on Cloudflare.
- In the browser: no fixed limit, bounded by the device's memory.

## Formats

- Images on Cloudflare: PNG, JPG, WebP, AVIF, HEIC in; PNG, JPG, WebP, AVIF out.
- Video on Cloudflare: MP4, MOV, MKV and most other video in; MP4 (H.264), M4A audio or a still frame out.
- In the browser: MP4, WebM, GIF, MP3, WAV, OGG, M4A and still frames out; PNG, JPG and WebP for images.

## Pages

${PAGES.map((p) => `- [${p.link}](${origin}/${p.slug}): ${p.desc}`).join("\n")}

## HTTP API

The API serves the web app. Video jobs need a Cloudflare Turnstile token, so it is not meant for scripts.

- POST ${origin}/api/image?format=webp|avif|png|jpeg&quality=1-100&width=px with the image as the body returns the converted image.
- POST ${origin}/api/jobs creates a video job; GET ${origin}/api/jobs/{id} reports progress; GET ${origin}/api/jobs/{id}/download returns the result.
- GET ${origin}/api/quota returns the remaining daily allowance for the caller.
`;

async function quota(req, env) {
  const ip = await ipHash(req, env);
  const { results } = await env.DB.prepare("SELECT subject, units FROM usage WHERE day = ?1 AND subject IN (?2, ?3, 'img:global', 'job:global')")
    .bind(today(), "img:" + ip, "job:" + ip).all();
  const used = Object.fromEntries(results.map((r) => [r.subject, r.units]));
  const left = (kind, perIp, global) => Math.max(0, Math.min(+perIp - (used[kind + ":" + ip] || 0), +global - (used[kind + ":global"] || 0)));
  return json({ images: left("img", env.IMAGE_DAILY_PER_IP, env.IMAGE_DAILY_GLOBAL), videos: left("job", env.JOB_DAILY_PER_IP, env.JOB_DAILY_GLOBAL) }, 200, { "cache-control": "no-store" });
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  const origin = url.origin;
  if (m === "GET" && (p === "/" || p === "/index.html"))
    return new Response(renderPage(null, env, origin), { headers: { ...HTML_HEADERS, "cache-control": "public, max-age=300" } });
  if (m === "GET" && BY_SLUG[p.slice(1)])
    return new Response(renderPage(BY_SLUG[p.slice(1)], env, origin), { headers: { ...HTML_HEADERS, "cache-control": "public, max-age=300" } });
  if (m === "GET" && p.length > 1 && p.endsWith("/") && BY_SLUG[p.slice(1, -1)]) return Response.redirect(origin + p.slice(0, -1), 301);
  if (m === "GET" && p === "/sitemap.xml") return new Response(sitemap(origin), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (m === "GET" && p === "/robots.txt") return new Response(robots(origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (m === "GET" && p === "/llms.txt") return new Response(llms(origin, env), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (m === "GET" && p === "/og.png") return new Response(OG, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
  if (m === "GET" && p === "/api/quota") return quota(req, env);
  if (m === "GET" && LEGAL[p.slice(1)])
    return new Response(legalPage(p.slice(1), env, origin), { headers: { ...HTML_HEADERS, "cache-control": "public, max-age=3600" } });
  if (m === "GET" && (p === "/vendor/ffmpeg-core.js" || p === "/vendor/ffmpeg-core.wasm")) return vendor(p.slice(8));
  if (m === "GET" && p === "/ffworker.js")
    return new Response(FFWORKER, { headers: { "content-type": "text/javascript", "cache-control": "public, max-age=3600" } });
  if (m === "GET" && (p === "/favicon.svg" || p === "/favicon.ico"))
    return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=604800" } });
  if (m === "GET" && p === "/fonts.css") return fontCss(ctx);
  const fm = m === "GET" && p.match(/^\/fonts\/(fs|gs)\/(.+)$/);
  if (fm) return fontFile(fm[1], fm[2]);
  if (m === "GET" && p === "/api/health") return json({ ok: true });
  if (m === "POST" && p === "/api/session") return createSession(req, env, url);
  if (m === "POST" && p === "/api/image") return handleImage(req, env, url);
  if (m === "POST" && p === "/api/jobs") return createJob(req, env, url);

  const jm = p.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/(upload|start|download))?$/);
  if (jm) {
    const [, id, , action] = jm;
    if (m === "PUT" && action === "upload") return handleUpload(req, env, id, url);
    const job = await getJob(env, id);
    if (!job) return err("Job not found.", 404);
    if (m === "POST" && action === "start") {
      if (!sameOrigin(req, url) || job.ip_hash !== (await ipHash(req, env))) return err("Job not found.", 404);
      if (job.engine !== "stream" || job.status !== "uploading") return err("This job can't be started now.", 409);
      await startWorkflow(env, id);
      return json({ ok: true });
    }
    if (m === "GET" && !action) return json(publicJob(job), 200, { "cache-control": "no-store" });
    if (m === "GET" && action === "download") {
      if (job.status !== "done") return err("Not ready yet.", 409);
      const obj = await env.FILES.get(job.output_key);
      if (!obj) return err("This file has expired. Converted files are deleted after 24 hours.", 410);
      return new Response(obj.body, {
        headers: {
          ...FILE_HEADERS,
          "content-type": job.output_type || "application/octet-stream",
          "content-disposition": `attachment; filename="${safeName(job.output_name, (job.output_name || "").split(".").pop() || "bin")}"`,
          "content-length": String(obj.size),
        },
      });
    }
  }
  if (p.startsWith("/api/")) return err("Not found.", 404);
  return new Response(NOT_FOUND(url.origin), { status: 404, headers: { ...HTML_HEADERS, "cache-control": "public, max-age=300" } });
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      console.error(e);
      return err("Something went wrong. Try again in a moment.", 500);
    }
  },
  // Safety net: remove leftover uploads, Stream copies, results and old rows.
  async scheduled(event, env, ctx) {
    const t = Date.now();
    const vids = await env.STREAM.videos.list({ before: new Date(t - 2 * 3600 * 1000).toISOString(), limit: 100 }).catch(() => []);
    for (const v of vids) if (v.creator === "convert") await env.STREAM.video(v.id).delete().catch(() => {});
    // Inputs whose job never ran: 2 hours. Results: 23 hours, so none outlives 24 with an hourly cron.
    for (const [prefix, age] of [["in/", 2 * 3600 * 1000], ["out/", 23 * 3600 * 1000]]) {
      let cursor;
      do {
        const list = await env.FILES.list({ prefix, cursor, limit: 500 });
        const old = list.objects.filter((o) => t - o.uploaded.getTime() > age).map((o) => o.key);
        if (old.length) await env.FILES.delete(old);
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    await env.DB.prepare("DELETE FROM jobs WHERE created_at < ?1").bind(t - 2 * 86400 * 1000).run();
    await env.DB.prepare("DELETE FROM usage WHERE day < ?1").bind(new Date(t - 7 * 86400 * 1000).toISOString().slice(0, 10)).run();
  },
};
