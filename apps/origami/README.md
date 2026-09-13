# Origami

Cloudflare Worker package registry for Paperboard.

## Endpoints

- **`GET /package/:package-name.json`**: Retrieves metadata for a specific package from the `PACKAGES` KV store (e.g. `/package/java-26.json`).
- **`GET /package/index.json`**: Retrieves the entire KV stack with all packages and their metadata as a key-value dictionary.
- **`GET /`**: Worker health & service info.

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
