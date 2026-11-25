# Contributing to convert

Thanks for wanting to help. This is a small tool, so contributing should feel small too.

## Getting started

1. Fork and clone the repo, then `npm install`.
2. Follow the self-hosting steps in the README to get your own Cloudflare resources, or work on the UI and local (ffmpeg.wasm) features without them.
3. `cp .dev.vars.example .dev.vars` and run `npm run dev`.

## Making changes

- Keep it dependency-free at runtime: the Worker is plain JavaScript, the UI is one HTML file.
- Run `npm run check` and `npm run build` before opening a pull request. CI runs both.
- One topic per pull request, with a short description of what changed and how you tested it.
- UI changes: add a screenshot to the pull request.
- New cloud features must stay inside the existing cost guards (rate limits, quotas, Turnstile) or add their own.

## Commit messages

Short, imperative, lowercase is fine: `add opus output for local audio`.

## License of contributions

By contributing you agree that your contribution is licensed under the project's license, [AGPL-3.0-or-later](LICENSE).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind in reviews; we review code like gardeners, not judges.
