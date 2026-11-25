# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting ("Report a vulnerability" in the Security tab of this repository), or email **hello@shiftbloom.studio** with the subject `security: convert`.

Please include what you found, how to reproduce it and the impact you expect. We aim to reply within 7 days and will credit you in the fix unless you prefer otherwise.

## Scope

- The Worker in `src/` and the deployment at convert.shiftbloom.studio.
- Abuse vectors that bypass rate limits, quotas or Turnstile and could cause cost or availability problems.

Out of scope: denial of service through volumetric traffic, reports that require a compromised Cloudflare account, and issues in third-party services such as Cloudflare, jsDelivr or ffmpeg.wasm. Please report those upstream.

## Supported versions

Only the latest commit on `main` is supported.
