# Origami

Cloudflare Worker package registry for Paperboard.

## Endpoints

- **`GET /package/:package-name.json`**: Retrieves metadata for a specific package from the `PACKAGES` KV store (e.g. `/package/java-26.json`).
- **`GET /package/index.json`**: Retrieves the entire KV stack with all packages and their metadata as a key-value dictionary.
- **`GET /`**: Worker health & service info.

## Downloads (`i.paperboard.dev`)

Binaries live on GitHub Releases; Origami only 302-redirects to them (plus the small `latest.yml` updater feeds from R2). A KV version database (`dl/pb`, `dl/crane` in the `PACKAGES` namespace) is the source of truth — unknown versions and unrecorded files are 404s.

- **`GET /pb/latest/:file`** and **`GET /crane/latest/:file`**: redirect to the current release asset (not cached).
- **`GET /pb/:version/:file`** and **`GET /crane/:version/:file`**: redirect to that version's asset (immutable, cached). Previous versions keep working.
- **`GET /pb/latest.yml`**, **`/pb/latest-mac.yml`**, **`/pb/latest-linux.yml`**: electron-updater feeds (R2).
- Everything else on this host — including `/`, the registry, panels, and publish routes — is a 404.

The same routes exist under `/paperdl/` on the main host (`origami.ariapis.com`). The old `/paperdl/:app/:target/download` paths 302 to the canonical latest file so existing installs keep updating.

## Development

```bash
# Start local development server
bun run dev

# Run test suite
bun test

# Type check
bun run typecheck

# Deploy to Cloudflare
bun run deploy
```

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
