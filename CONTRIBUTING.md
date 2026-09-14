# Contributing to Paperboard

Paperboard is **source-available, not open source**. The app, panels, and
registry are licensed under the PolyForm Noncommercial License 1.0.0: you may
read, modify, and share the code for noncommercial purposes, but you may not use
it commercially. Files in `packages/paperapi`, `packages/paperui`, and
`apps/paperdocs` are MIT — see the `LICENSE` file in each directory.

We welcome contributions to the main app. By submitting a pull request you agree
to the [Contributor License Agreement](./CLA.md).

## Before you start

- Open an issue to discuss non-trivial changes before writing code.
- Forking and modifying the code for noncommercial purposes is permitted by the
  license, so you can work on a fork or branch and open a pull request from it.

## Workflow

1. Branch from `main`.
2. Use conventional commits (`feat:`, `fix:`, `chore:`).
3. Add a test for any behavioral change. Pure logic without a test needs a
   one-line reason in the PR.
4. Run the gate from the repo root and make sure it is green:

   ```bash
   bun run gate
   ```

5. Open the PR and accept the CLA in the description.

## Rules

These mirror `AGENTS.md`; read it before contributing.

- No silent failure. Never write `catch {}`; log, rethrow, or return a typed
  error.
- No shell strings from input. Spawn with argv arrays, never `sh -c` with
  interpolated values.
- Explicit panel identity everywhere. No hostname parsing, no `process.env`
  fallbacks.
- Bound everything. Every Set, Map, and Timer needs a teardown path.
- Do not create or edit `CHANGELOG.md` files. Changelogs are suspended.
