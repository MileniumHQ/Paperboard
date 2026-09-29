# Contributing to Paperboard

Paperboard is **source-available, not open source**. The app, panels, and
registry are licensed under the PolyForm Noncommercial License 1.0.0: you may
read, modify, and share the code for noncommercial purposes, but you may not use
it commercially. Files in `packages/paperapi`, `packages/paperui`, and
`apps/paperdocs` are MIT; see the `LICENSE` file in each directory.

Pull requests are welcome. By submitting one you agree to the
[Contributor License Agreement](./CLA.md).

## What we are most likely to accept

- Small, focused bug fixes.
- Small reliability and performance fixes.
- Tightly scoped maintenance that clearly improves the project.

## What we are least likely to accept

- Large PRs and drive-by feature work.
- Opinionated rewrites.
- Anything that widens product scope without us asking for it first.

## Discuss first

For a non-trivial change, open an issue before writing code. It won't
guarantee we want the PR, but it saves you the time if we don't.

## Making a change

1. Branch from `main`.
2. Use conventional commits (`feat:`, `fix:`, `chore:`), one concern per commit.
3. Add a test for any behavioral change; it should fail without your fix. Pure
   logic without a test needs a one-line reason in the PR.
4. Run the gate from the repo root and make sure it is green:

   ```bash
   bun run gate
   ```

   The gate does not rebuild panels. Run `bun run build:panels` to see panel
   changes in the app.
5. Open the PR and accept the CLA in the description.

## What a good PR includes

- What changed, and why it should exist, in plain language.
- Before/after images for any UI change, and a short video when timing,
  transitions, or interaction matter.
- One concern only. If the description says "also", split it.

If we have to guess what changed, we are much less likely to review it.

## Rules

These mirror [AGENTS.md](./AGENTS.md), which has the full set; read it before
contributing.

- No silent failure. Never write `catch {}`; log, rethrow, or return a typed
  error.
- No shell strings from input. Spawn with argv arrays, never `sh -c` with
  interpolated values.
- Explicit panel identity everywhere. No hostname parsing, no `process.env`
  fallbacks.
- Bound everything. Every Set, Map, and Timer needs a teardown path.
- Secrets go through the daemon vault, never panel config.
- Do not create or edit `CHANGELOG.md` files. Changelogs are suspended.

## Be realistic

Opening a PR creates no obligation on our side. We may ask you to shrink it,
close it, or reimplement the idea later.
