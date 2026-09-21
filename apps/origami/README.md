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

## Configuration

KV binding is defined in `wrangler.jsonc`:
- **Binding Name**: `PACKAGES`
- **ID**: `ORIGAMI_PACKAGES_KV`
