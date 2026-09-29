# Origami

Cloudflare Worker package registry for Paperboard.

## Endpoints

- **`GET /package/:package-name.json`**: Retrieves metadata for a specific package from the `PACKAGES` KV store (e.g. `/package/java-26.json`).
- **`GET /package/index.json`**: Retrieves the entire KV stack with all packages and their metadata as a key-value dictionary.
- **`GET /`**: Worker health & service info.

## Panel library (`/library/`)

The panel library is a division of this origin, not part of the Paperboard window: a Solid + PaperUI web app under `library/`, built to `library/dist` and served as static assets from the same origin as `/panels/index.json`. It reads the registry directly and downloads archives from `/panel/:id/download`; no separate API exists for it.

When it runs inside Paperboard's iframe, the shell completes a postMessage handshake and the install action becomes a signal round-trip (the shell performs the daemon install and answers with the result). Opened directly in a browser, it never handshakes and the action is a plain archive download. `bun run build:library` is part of `dev` and `deploy`; the library's own suite runs with `bun run test:library`.

## Downloads (`i.paperboard.dev`)

Binaries live on GitHub Releases; Origami only 302-redirects to them (plus the small `latest.yml` updater feeds from R2). A KV version database (`dl/pb`, `dl/crane` in the `PACKAGES` namespace) is the source of truth — unknown versions and unrecorded files are 404s.

- **`GET /pb/latest/:file`** and **`GET /crane/latest/:file`**: redirect to the current release asset (not cached).
- **`GET /pb/:version/:file`** and **`GET /crane/:version/:file`**: redirect to that version's asset (immutable, cached). Previous versions keep working.
- **`GET /pb/latest.yml`**, **`/pb/latest-mac.yml`**, **`/pb/latest-linux.yml`**: electron-updater feeds (R2).
- Everything else on this host — including `/`, the registry, panels, and publish routes — is a 404.

The same routes exist under `/paperdl/` on the main host (`origami.ariapis.com`). The old `/paperdl/:app/:target/download` paths 302 to the canonical latest file so existing installs keep updating.

## Development

```bash
# Start local development server (builds the panel library, then wrangler dev)
bun run dev

# Run test suite (worker; the library division's suite is `bun run test:library`)
bun run test

# Type check
bun run typecheck

# Deploy to Cloudflare
bun run deploy
```

Local publish needs an `AUTH_KEY` in `.dev.vars` (gitignored); without one every publish is a 401 by design. The `dev` script pins `PANEL_BASE_URL` to `http://localhost:8787` because record URLs are stored from that setting, not from the request host — a local record written with the production base URL would serve its icon and download from production. If you run on another port, override `PANEL_BASE_URL` in `.dev.vars` to match. Records written before the override keep their stale URLs; republish.

## Package records

Package records (`java-<N>`, `ollama`) are written by operator scripts, never by a worker route. They write straight to the production `PACKAGES` namespace through wrangler, so sign in first with `bunx wrangler login`.

```bash
# every Adoptium feature release (or name them: -- 21 25)
bun run update:java

# latest stable Ollama release
bun run update:ollama

# print the records without writing
bun run update:ollama -- --dry-run
```

Every platform entry carries a `sha256` from the upstream authority (Adoptium's API, GitHub's asset digest cross-checked against `sha256sum.txt`). A platform without one is dropped (Java) or fails the whole record (Ollama). The daemon refuses to install without it. `layout` tells the daemon how the archive maps onto the package directory: `wrapped` (default, one top-level folder around `bin/`), `root` (archive root holds `bin/`), or `bin` (archive root *is* `bin/`).

## Configuration

KV binding is defined in `wrangler.jsonc`:
- **Binding Name**: `PACKAGES`
- **ID**: `ORIGAMI_PACKAGES_KV`
