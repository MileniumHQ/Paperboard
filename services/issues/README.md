# Issues

Collects the issues people send from **App Settings → Help → Report an Issue**, at `issues.ariapis.com`. The maintainer reads them on `/dashboard`, behind Cloudflare Access, and downloads each one as a prompt a coding agent runs to open a GitHub issue and a pull request that fixes it.

- `src/worker`: the Worker. `index.ts` routes and validates, `store.ts` is the Durable Object that keeps the issues, `access.ts` checks the Access token, `prompt.ts` writes the download.
- `src/dashboard`: the dashboard, a PaperUI page built by Vite into `dist/dashboard` and served by the Worker as static assets.
- `src/shared.ts`: what the app sends, the limits, and the shape each context field must take (`CONTEXT_SHAPES`). The app imports it as `issues/shared` (`apps/paperboard/src/main/issueSend.ts`), and its tests check its own context against the same shapes.

## Endpoints

- `POST /v1/issues`: public. Takes `application/json` with exactly `{ text, context, details }`. `text` is trimmed, 1 to 10,000 characters, with no control characters other than tabs and line breaks. `context` is exactly `appVersion`, `os`, `osVersion`, `arch` and `shell` (`window` or `browser`), each one line of at most 100 characters and held to the strict shape the app really sends (`CONTEXT_SHAPES`): a semver `appVersion`, `os` of `macOS`, `Windows` or `Linux`, an `osVersion` of letters, digits and `. _ + -` (so `6.12.57+deb13-amd64` passes), and `arch` one of Node's `process.arch` names. Anything else is a `400`, because the context lands in an agent's instructions. `details` is the diagnostics the person saw and left on (the computer, its panels and versions, recent warnings, errors and log lines, scrubbed in the app by `apps/paperboard/src/main/issueDetails.ts`), at most 60,000 characters, or `""`. Answers `201 { id }`. No CORS headers: the app posts from its main process, and a JSON post from a web page needs a preflight this service never answers.
- `GET /dashboard/`: the dashboard page.
- `GET /dashboard/api/issues`: one page of summaries (`id`, `receivedAt`, `title`, `context`, `hasDetails`), newest first, 100 at a time, as `{ issues, more }`. `?before=<ms>&beforeId=<id>` continues after that issue in `(receivedAt, id)` order, so issues sharing a millisecond are never skipped; `more` says older ones remain.
- `GET /dashboard/api/issues/:id`: one issue in full, `{ issue }` with its text and diagnostics.
- `GET /dashboard/api/issues/:id/prompt`: the issue as a prompt file (`paperboard-issue-<id>.txt`).
- `DELETE /dashboard/api/issues/:id`: deletes one issue. Only from the dashboard's own origin (`Origin` must match).

Errors are `{ error: { code, message } }`, and the app shows `message` to the person as it is.

## Limits

The submit endpoint has no sign-in, so everything it takes is bounded:

- **Size:** the body is read to at most 256 KiB, whatever `Content-Length` says (`413`).
- **Per address:** 5 issues a minute per `CF-Connecting-IP`, through the Cloudflare rate-limit binding (`429 rate_limited`). It is approximate and per location; shared NATs share it. The address is used for nothing else and never stored.
- **Everyone together:** 300 issues in any 24 hours (`429 busy`), and 5,000 kept at once (`503 full`) until some are deleted. Both are counted inside the Durable Object, so they hold exactly across locations.

## Access

The Access application **issues dashboard** covers `issues.ariapis.com/dashboard` (every path under it) on the `mileniumhq` team, with the same policy and identity provider as tribot: only the maintainer's account. The Worker checks the `Cf-Access-Jwt-Assertion` token on every dashboard request too: the signature against the team's published keys, the audience (`ACCESS_AUD` in `wrangler.jsonc`, the application's AUD tag), the issuer and the expiry. Without a valid token the dashboard answers 403; with no `ACCESS_AUD` set it answers 503, never an open dashboard. `workers_dev` and preview URLs are off, so the custom domain is the only way in.

## Development

```sh
bun run --cwd services/issues typecheck
bun run --cwd services/issues test
bun run --cwd services/issues build
```

Tests run the Worker in local workerd through Miniflare with the real rate-limit binding and Durable Object. Access's signing keys are a key pair made per run, served where the Worker fetches them, so tokens are signed and checked for real. `bun run dev` builds the dashboard and runs `wrangler dev` with storage in `/tmp/paperboard-issues-dev`; the dashboard answers 403 there, since no Access token reaches it.

## Deploying

The Worker `issues` is deployed by hand with Wrangler; no CI job deploys it.

1. Create the Access application (once): self-hosted, domain `issues.ariapis.com/dashboard`, the `Only Pxl` policy and identity provider as the tribot application. Put its AUD tag in `ACCESS_AUD` in `wrangler.jsonc`.
2. Rate-limit namespace `1281931` must be unused by any other Worker in the account.
3. `bun run --cwd services/issues deploy` builds the dashboard and deploys. The first deploy creates the `issues.ariapis.com` custom domain (its DNS record and certificate) and the Durable Object. Keep the store's name (`issues-v1`) and the migration across releases: changing either loses every issue. The store adds columns in place when it starts (`details` came after the first release), so a new column needs a default for the rows already kept.
4. Check that `POST /v1/issues` answers 201, that `/dashboard` asks for the Access sign-in, and that a download opens as a prompt.
