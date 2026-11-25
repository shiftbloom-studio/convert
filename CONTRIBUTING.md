# Contributing to convert

Thanks for wanting to help. This is a small tool, so contributing should feel small too.

## Getting started

1. Fork and clone the repo, then `npm install`.
2. Follow the self-hosting steps in the README to get your own Cloudflare resources, or work on the UI and local (ffmpeg.wasm) features without them.
3. `cp .dev.vars.example .dev.vars` and run `npm run dev`.

## Making changes

- Keep it dependency-free at runtime: the Worker is strict TypeScript (erasable syntax only, bundled by Wrangler), the UI is one HTML file.
- Run `npm run check` and `npm run build` before opening a pull request. CI runs both.
- One topic per pull request, with a short description of what changed and how you tested it.
- UI changes: add a screenshot to the pull request.
- New cloud features must stay inside the existing cost guards (rate limits, quotas, Turnstile) or add their own.

## Commit messages

Short, imperative, lowercase is fine: `add opus output for local audio`.

## Working on an issue

Issues labeled `good first issue` or `help wanted` are open to anyone. Before you write code:

1. Comment on the issue and say how you plan to approach it: the files you expect to touch, and anything you would do differently from what the issue suggests. A few sentences are enough.
2. Wait until a maintainer assigns the issue to you. That way two people don't build the same thing, and we can point out a dead end before you spend an evening on it.
3. Open the pull request and link the issue (`Closes #123`).

Typo fixes and other small, obvious changes can go straight to a pull request.

If an assigned issue sees no activity for 14 days, we'll check in and may hand it to someone else. You're welcome to pick it up again later.

## Using AI tools

You're welcome to use AI assistants, the same way you'd use an editor or a linter. We only ask that a person stands behind every contribution:

- You have read and understood every line you submit, and you ran the checks yourself.
- You answer review questions in your own words and can change the code when we ask.
- The pull request description explains what you decided and why. The diff already shows what changed.

Issues, comments and pull requests that an agent wrote and posted on its own, with nobody actually involved, will be closed. This isn't about the tool. We'd like to get to know the people who work on this project.

## License of contributions

By contributing you agree that your contribution is licensed under the project's license, [AGPL-3.0-or-later](LICENSE).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind in reviews; we review code like gardeners, not judges.
