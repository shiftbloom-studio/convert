# convert.

convert turns the file you have into the file you need. Images and short videos are handled by Cloudflare Images and Stream and deleted after 24 hours. Everything else runs through ffmpeg.wasm in the browser and never leaves the visitor's machine.

**Live:** [convert.shiftbloom.studio](https://convert.shiftbloom.studio), free and without an account · **License:** AGPL-3.0-or-later

Before converting, people choose where it happens. "On Cloudflare" is faster and uploads the file. "In your browser" is slower and keeps the file on the device. Each row in the list shows which of the two it will use, and limits are checked before anything is uploaded.

| Input | On Cloudflare | In the browser |
| --- | --- | --- |
| Images (PNG, JPG, WebP, AVIF, GIF, HEIC) | PNG, JPG, WebP or AVIF through the Images binding, with quality and maximum width | PNG, JPG or WebP |
| Video (MP4, MOV, WebM, MKV and more) | MP4 (H.264), M4A audio or a still frame through Media Transformations or Stream | MP4, WebM, GIF, MP3 or a still frame |
| Audio (MP3, WAV, FLAC, OGG and more) | not offered | MP3, WAV, OGG or M4A |

## Features

- Image conversion on Cloudflare with quality and maximum width. Images are never stored.
- Cloud video jobs for MP4, M4A and still frames, run as durable Workflows with retries and live progress.
- Local image, video and audio conversion in the browser with ffmpeg.wasm, so those files never leave the device.
- Eight format pages such as `/heic-to-jpg`, plus a sitemap, `robots.txt` and `llms.txt`.
- Turnstile, origin checks, file signature checks, per-IP rate limits and daily quotas to keep the free service usable and its costs predictable.
- No accounts, no analytics and no cookies. Inputs and results are deleted after at most 24 hours.

## How it works

```
browser ──▶ Worker (src/index.js)
             ├─ GET  /, /heic-to-jpg, …      pages (src/ui.html + src/pages.js), fonts proxied via /fonts.css
             ├─ GET  /privacy, /imprint, …    legal pages (src/legal.js), operator from LEGAL_* vars
             ├─ POST /api/session ─────────▶ Turnstile ─▶ 20 minute key for images
             ├─ POST /api/image ───────────▶ checks ─▶ Images binding ─▶ response (nothing stored)
             ├─ POST /api/jobs ────────────▶ Turnstile + rate limit + daily quotas, then:
             │    MP4 ≤ 100 MB   ─ PUT /api/jobs/:id/upload ─▶ R2 in/ ─┐
             │    other ≤ 200 MB ─ direct upload to Stream ─────────────┤
             │                                                          ▼
             │                                           Workflow convert-job
             │                       media:  R2 ─▶ Media binding ─▶ R2 out/
             │                       stream: wait for encode ─▶ MP4/M4A download ─▶ R2 out/ ─▶ delete video
             ├─ GET  /api/jobs/:id           progress (D1)
             ├─ GET  /api/jobs/:id/download  result (R2)
             └─ GET  /api/quota              remaining daily allowance
```

Workers serve the HTTP API, the pages, the font proxy and an hourly cleanup cron. A Workflow drives each video job through its steps with retries. R2 holds inputs and results, and a lifecycle rule removes everything after one day. D1 keeps job state and the daily usage counters from `schema.sql`.

Images uses the Images binding. MP4 inputs up to 100 MB take the fast path through Media Transformations. Every other video goes through Stream, and the Stream copy is deleted as soon as the result is in R2. Local conversions run ffmpeg.wasm in a web worker (`src/ffworker.js.txt`). The Worker serves the core under `/vendor/`, fetched once from jsDelivr and cached at the edge, and every local result is written without metadata or chapters.

### Abuse and bad files

- Turnstile runs before each video job and before an image session. The script only loads once someone converts on Cloudflare, and the Worker checks the token's hostname and action.
- Every POST and PUT to the API must come from the page's own origin.
- Images are read into memory (at most 20 MB) and must start with the magic bytes of PNG, JPEG, GIF, WebP, AVIF or HEIC. SVG is refused. Their dimensions are read before decoding, and anything over 50 megapixels or 12,000 pixels per side is refused.
- MP4 uploads must start with an `ftyp` box that isn't an image brand, checked before a byte reaches R2. Uploads must come from the connection that created the job. Other videos go to Stream, which refuses anything it can't decode, with a 10 minute limit.
- Results are always served as downloads with the target's type, `nosniff` and a sandbox CSP. Pages send `frame-ancestors 'none'`.
- Rate limits and quotas key on an HMAC of the IP and the day, derived from the Turnstile secret. Workers rate limits cap each connection per minute, and D1 counters cap it per day.
- The hourly cron deletes inputs older than 2 hours, results older than 23 hours, Stream copies, job rows after 2 days and counters after 7.

### Limits

On Cloudflare, images can be up to 20 MB, which is the input limit of the Images binding. Videos can be up to 200 MB and 10 minutes, with MP4 up to 100 MB taking the faster path. In the browser the only limit is the device's memory.

The per-IP and global daily quotas live in `wrangler.jsonc` under `vars` and keep the bill predictable.

### Passes

The per-connection allowance punishes everyone behind a shared connection. People signed in at a [stem](https://github.com/shiftbloom-studio/stem) issuer can get passes: anonymous [Privacy Pass](https://www.rfc-editor.org/rfc/rfc9578) tokens, 50 a day, one per conversion once the connection's free ones are used up. The browser blinds each pass before stem signs it (`src/passes.client.js`, no dependencies), so neither stem nor convert can tell later whose pass it was. The Worker checks stem's signature with the key from stem's issuer directory and a Durable Object per key remembers spent passes (`src/passes.js`). The global daily caps still apply.

Set `PASS_ISSUER` to stem's origin and add convert's origin to that stem's `PASS_ORIGINS`. On the same Cloudflare account, also bind stem as `STEM` (see `wrangler.jsonc`) so the Worker doesn't fetch keys over the public hostname. Without `PASS_ISSUER` nothing changes.

### SEO and pages

`src/pages.js` holds the copy for the start page and eight format pages such as `/heic-to-jpg`. Each page loads the same converter with a preset target and adds its own article, canonical URL, Open Graph tags and JSON-LD. The Worker also serves `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/og.png` and an HTML 404 page. All URLs are built from the request's origin, so they follow your own domain.

## Tech stack

- Plain JavaScript modules bundled by Wrangler, with the UI in one HTML file. ffmpeg.wasm runs in a web worker in the browser.
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

To use your own domain, uncomment `routes` in `wrangler.jsonc`. Rate-limit `namespace_id`s must be unique per account, so change them if they collide with another Worker. Point `REPO` in `src/pages.js` and the GitHub links in `src/ui.html` at your fork.

### Deploy with Workers Builds

convert.shiftbloom.studio deploys with Workers Builds on every push to `main`, and no API token is stored on GitHub. Connect the repository to the Worker in the Cloudflare dashboard (Settings > Build). Keep the D1 database id out of the repository: let the build command fill it into a deploy config from a build variable, and deploy that config with `npx wrangler deploy --keep-vars`, so the vars you set in the dashboard stay. The build picks up Node 26 from `.node-version`.

### Logs in PostHog

Workers Logs can be exported over OpenTelemetry without code changes. Create a logs destination under Workers & Pages > Observability > Destinations with the URL `https://eu.i.posthog.com/i/v1/logs` (or `us.i.posthog.com`) and the header `Authorization: Bearer <your PostHog project token>`, then add it to the Worker's config:

```jsonc
"observability": { "enabled": true, "logs": { "enabled": true, "destinations": ["<your-destination-name>"] } }
```

Set the var `POSTHOG_LOGS` to `eu` or `us` so the privacy policy names PostHog and where it stores the logs.

## Development

```sh
cp .dev.vars.example .dev.vars   # Turnstile test secret
npm run dev                      # wrangler dev --remote (Images, Media and Stream need remote bindings)
npm run check                    # syntax check and tests
npm run build                    # wrangler dry run into dist/
```

## Privacy

convert has no accounts and sets no cookies. There is no analytics script.

Uploaded videos and results stay in R2 for at most 24 hours. Images are converted in a single request and never stored. Stream copies are deleted as soon as the result is saved. Files converted in the browser are never uploaded.

IP addresses are only used as a keyed hash that changes every day, for rate limits and quotas. Fonts and the ffmpeg core are served by the Worker, so visitors never connect to Google Fonts, Fontshare or jsDelivr. Turnstile loads only when something is converted on Cloudflare.

The privacy policy and imprint live in `src/legal.js`, in English and German, at `/privacy`, `/datenschutz`, `/imprint` and `/impressum`. The operator's name, address and contact come from the `LEGAL_*` variables in `wrangler.jsonc`, so set them for your own deployment and check that the text still matches what your copy does.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please don't report vulnerabilities in public issues. Use GitHub's private vulnerability reporting on this repository or email [safety@shiftbloom.studio](mailto:safety@shiftbloom.studio). [SECURITY.md](SECURITY.md) has the details.

## License

Copyright © 2026 shiftbloom studio and contributors.

convert is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`).

If you run a modified version as a network service, the AGPL requires you to offer its source code to your users. The "Read the code" link in the UI does this, so point it at your fork.

Third-party components keep their own licenses. ffmpeg.wasm (`@ffmpeg/core`, GPL-2.0-or-later including x264) is fetched at runtime from jsDelivr, served by the Worker and is not part of this repository. The brand typefaces are served under their own licenses (ITF Free Font License, SIL OFL).
Brand assets are not covered by the AGPL. That includes the Bloom mark, the wordmark, the typefaces and `src/og.png` with its source `assets/og.html`, so please don't use them for forks.

---

convert is part of [shiftbloom studio](https://shiftbloom.studio), an open studio from Hamburg. All of our apps are open source at [github.com/shiftbloom-studio](https://github.com/shiftbloom-studio).
