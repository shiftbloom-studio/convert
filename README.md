# convert

File converter for images, video and audio, running on Cloudflare: **https://convert.shiftbloom.studio**

Drop files, pick a target format, download the result. Every format is labeled either **Cloud** (converted on Cloudflare) or **Local** (converted in the browser with ffmpeg.wasm, nothing is uploaded).

| Input | Cloud | Local |
| --- | --- | --- |
| Images (PNG, JPG, WebP, AVIF, GIF, HEIC …) | PNG, JPG, WebP, AVIF via **Images** binding (resize + quality) | – |
| Video (MP4, MOV, WebM, MKV …) | MP4 (H.264), M4A, still frame JPG/PNG via **Media Transformations** or **Stream** | WebM, GIF, MP3, MP4 |
| Audio (MP3, WAV, FLAC, OGG …) | – | MP3, WAV, OGG, M4A |

## How it works

```
browser ──▶ Worker (convert)
             ├─ POST /api/image ─────────▶ Images binding ─▶ response (no storage)
             ├─ POST /api/jobs ──────────▶ Turnstile + quotas, then:
             │    MP4 ≤ 100 MB  ─ PUT /api/jobs/:id/upload ─▶ R2 in/  ─┐
             │    other ≤ 200 MB ─ direct upload to Stream ────────────┤
             │                                                          ▼
             │                                         Workflow convert-job
             │                     media:  R2 ─▶ Media binding ─▶ R2 out/
             │                     stream: wait encode ─▶ generate download ─▶ R2 out/ ─▶ delete from Stream
             ├─ GET /api/jobs/:id           (progress from D1)
             └─ GET /api/jobs/:id/download  (from R2)
```

- **R2** `convert-files`: inputs and results, lifecycle rule deletes everything after 24 h.
- **D1** `convert-db`: job state and daily usage counters (`schema.sql`).
- **Workflows** `convert-job`: durable multi-step video jobs with retries.
- **Stream**: ingest for non-MP4 video, MP4/M4A downloads; videos are deleted right after copying, hourly cron sweeps leftovers.
- **Media Transformations** binding: fast MP4/M4A/frame output for MP4 inputs up to 100 MB.
- **Turnstile** for video jobs, **rate limiting** binding plus per-IP and global daily quotas (`vars` in `wrangler.jsonc`) to keep costs predictable.
- **ffmpeg.wasm** (`@ffmpeg/core` single-thread from jsDelivr) for local conversions in a web worker.

## Limits

Images 25 MB · cloud video 100 MB (MP4 fast path) / 200 MB (Stream), max 10 min · local: limited by browser memory.

## Deploy

```sh
npx wrangler d1 execute convert-db --remote --file schema.sql   # once
npx wrangler secret put TURNSTILE_SECRET                        # once
npx wrangler deploy
```
