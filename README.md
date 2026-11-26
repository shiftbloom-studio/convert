# convert.

Convert images, video and audio in the browser. No sign-up, and files are deleted within 24 hours.

**Live:** [convert.shiftbloom.studio](https://convert.shiftbloom.studio), free and without an account · **License:** AGPL-3.0-or-later

A small, open file converter running on Cloudflare.

Drop files, pick a target format, download. Every format is labelled either **cloud** (converted on Cloudflare) or **local** (converted in your browser with ffmpeg.wasm - nothing is uploaded).

| Input | Cloud | Local |
| --- | --- | --- |
| Images (PNG, JPG, WebP, AVIF, GIF, HEIC …) | PNG, JPG, WebP, AVIF via the **Images** binding (resize + quality) | – |
| Video (MP4, MOV, WebM, MKV …) | MP4 (H.264), M4A, still frame JPG/PNG via **Media Transformations** or **Stream** | WebM, GIF, MP3, MP4 |
| Audio (MP3, WAV, FLAC, OGG …) | – | MP3, WAV, OGG, M4A |

The UI is in German; contributions for other languages are welcome.

## Features

- Image conversion on Cloudflare with resize and quality settings. Nothing is stored.
- Cloud video jobs for MP4, M4A and still frames, run as durable Workflows with retries and live progress.
- Local video and audio conversion in your browser with ffmpeg.wasm, so those files never leave your device.
- Turnstile, per-IP rate limits and daily quotas to keep the free service usable and its costs predictable.
- No accounts, no analytics and no cookies. Inputs and results are deleted after at most 24 hours.

## How it works

```
browser ──▶ Worker (src/index.ts)
             ├─ GET  /                     UI (src/ui.html), fonts proxied via /fonts.css
             ├─ POST /api/image ───────────▶ Images binding ─▶ response (nothing stored)
             ├─ POST /api/jobs ────────────▶ Turnstile + rate limit + daily quotas, then:
             │    MP4 ≤ 100 MB   ─ PUT /api/jobs/:id/upload ─▶ R2 in/ ─┐
             │    other ≤ 200 MB ─ direct upload to Stream ─────────────┤
             │                                                          ▼
             │                                           Workflow convert-job
             │                       media:  R2 ─▶ Media binding ─▶ R2 out/
             │                       stream: wait for encode ─▶ MP4/M4A download ─▶ R2 out/ ─▶ delete video
             ├─ GET  /api/jobs/:id           progress (D1)
             └─ GET  /api/jobs/:id/download  result (R2)
```

| Piece | Used for |
| --- | --- |
| Workers | HTTP API, UI, font proxy, hourly cleanup cron |
| Workflows | durable multi-step video jobs with retries |
| R2 | inputs and results; a lifecycle rule deletes everything after 1 day |
| D1 | job state and daily usage counters (`schema.sql`) |
| Images | image conversion |
| Media Transformations | fast MP4 / M4A / frame output for MP4 inputs ≤ 100 MB |
| Stream | ingest for other video formats; videos are deleted right after copying |
| Turnstile | bot check before every cloud video job |
| Rate limiting | per-IP limits on both endpoints |
| ffmpeg.wasm | local conversions in a web worker (`src/ffworker.js.txt`), core loaded from jsDelivr |

### Limits

Images 25 MB · cloud video 100 MB (MP4 fast path) or 200 MB (Stream), max. 10 minutes · local conversions are limited by browser memory.
Per-IP and global daily quotas are configured in `wrangler.jsonc` (`vars`) to keep costs predictable.

## Tech stack

- TypeScript, checked with `tsc` and bundled by Wrangler. ffmpeg.wasm runs in a web worker in the browser.
- Cloudflare Workers with Workflows, R2, D1, Images, Media Transformations, Stream, Turnstile, rate limiting and a Cron Trigger
- Node.js 26 for builds and checks

## Self-hosting

You need a Cloudflare account with Workers Paid (for Workflows), R2, Images and Stream enabled, plus Node.js 26.

```sh
git clone https://github.com/shiftbloom-studio/convert && cd convert
npm install
npx wrangler login

# 1. storage
npx wrangler r2 bucket create convert-files
npx wrangler r2 bucket lifecycle add convert-files expire-1d --expire-days 1 --force
npx wrangler d1 create convert-db          # paste the id into wrangler.jsonc
npm run db:init                             # creates the tables from schema.sql

# 2. bot protection: create a Turnstile widget for your hostname, then
#    set TURNSTILE_SITEKEY in wrangler.jsonc and the secret here:
npx wrangler secret put TURNSTILE_SECRET

# 3. ship it
npm run deploy
```

To use your own domain, uncomment `routes` in `wrangler.jsonc`.
Rate-limit `namespace_id`s must be unique per account - change them if they collide with another Worker.

### Deploy with Workers Builds

convert.shiftbloom.studio deploys with Workers Builds on every push to `main`, and no API token is stored on GitHub. Connect the repository to the Worker in the Cloudflare dashboard (Settings > Build). Keep the D1 database id out of the repository: let the build command fill it into a deploy config from a build variable, and deploy that config with `npx wrangler deploy --keep-vars`, so the vars you set in the dashboard stay. The build picks up Node 26 from `.node-version`.

## Development

```sh
cp .dev.vars.example .dev.vars   # Turnstile test secret
npm run dev                      # wrangler dev --remote (Images, Media and Stream need remote bindings)
npm run check                    # typecheck, then a syntax check of the browser code
npm run build                    # wrangler dry run into dist/
```

## Privacy

- No accounts, no analytics, no cookies set by the app.
- Uploaded files and results live in R2 for at most 24 hours; Stream copies are deleted as soon as the result is stored.
- Local conversions never leave the browser.
- IP addresses are only used as a salted, daily-rotating hash for rate limiting and quotas.
- Fonts are proxied through the Worker, so visitors don't connect to Google Fonts or Fontshare.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please don't report vulnerabilities in public issues. Use GitHub's private vulnerability reporting on this repository or email [safety@shiftbloom.studio](mailto:safety@shiftbloom.studio). [SECURITY.md](SECURITY.md) has the details.

## License

Copyright © 2026 shiftbloom studio and contributors.

convert is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`).

If you run a modified version as a network service, the AGPL requires you to offer its source code to your users - the "Quellcode ansehen" link in the UI does this; point it at your fork.

Third-party components keep their own licenses: ffmpeg.wasm (`@ffmpeg/core`, GPL-2.0-or-later including x264) is loaded at runtime from jsDelivr and is not part of this repository; the brand typefaces are served under their own licenses (ITF Free Font License, SIL OFL).
Brand assets (the Bloom mark, wordmark and typefaces) are not covered by the AGPL; please don't use them for forks.

---

convert is part of [shiftbloom studio](https://shiftbloom.studio), an open studio from Hamburg. All of our apps are open source at [github.com/shiftbloom-studio](https://github.com/shiftbloom-studio).
