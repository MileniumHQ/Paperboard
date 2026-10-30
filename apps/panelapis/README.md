# Panel APIs

Server-side APIs for Paperboard panels, served under `panels.ariapis.com`. Each API owns its own path; the first is modscan, at `/modscan`.

## Modscan

Paperboard's server-side Steam Workshop metadata service. The owner's Steam Web API key stays in a Worker secret; desktop users do not supply keys. This app is independent of the Game Server panel and is not integrated into it.

### Terms review — 2026-10-30

**Conclusion: allowed with conditions**, as an application-specific backend for Paperboard, rather than a general Steam proxy. This is an interpretation of the published license, not written approval from Valve. Register Paperboard and its service domain accurately in the API key registration. The application owner remains responsible for every use of the key. No published clause reviewed requires one key per end user; serving data to multiple users is expressly contemplated.

Relevant clauses in the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) (the page says last updated July 2010):

- Section 2 licenses developers to “distribute Steam Data to end users for their personal use”. Keep use within the registered, owner-operated Application. Do not offer this as a public general-purpose API for other applications.
- Section 2 requires developers to “keep your Steam Web API key confidential”. A server secret complies with this design; shipping a key in desktop source/binaries would not. The license is personal, specific to the Application, and the owner is responsible for key usage.
- Section 2 caps “one hundred thousand (100,000) calls” per day. Every upstream attempt here reserves budget, including failures and keyless detail/collection calls. No retries occur automatically.
- Section 2 requires a privacy policy covering nonpublic end-user data, retrieval of data about users only on their request, disclosure of stored Steam Data, and identification of storage countries. It also prohibits marketing use, harmful load, cheating assistance, SSA violations, and presentation implying Valve endorsement or a different source of the data.
- Sections 2, 7 and 8 require as-is provision with substantially equivalent warranty and liability disclaimers. Response metadata includes a disclaimer, but the operator must also offer appropriate user-facing terms before launch.
- Section 3 requires Valve branding/links according to API documentation on pages incorporating data; links must remain followable. Section 5 forbids implying an additional relationship with Valve. Sections 10–11 allow changes and termination; regularly re-review, and remove implementation/data/branding when terminating use. Section 2 requires reporting material user breaches promptly to webapi@valvesoftware.com and reasonable corrective action.

The [Web API overview](https://partner.steamgames.com/doc/webapi_overview) describes protected methods intended for “trusted back-end applications”. It documents HTTPS endpoints and service `input_json` encoding. [QueryFiles](https://partner.steamgames.com/doc/webapi/IPublishedFileService#QueryFiles) requires a user authentication key, not a publisher key; its method documentation does not add a per-end-user-key requirement. [Remote Storage](https://partner.steamgames.com/doc/webapi/ISteamRemoteStorage) documents the two read-only detail methods as POST, without a required key. Publisher-only methods are outside this service.

The [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/) section 1.C keeps accounts personal and prohibits password/account sharing; no Steam login credentials are collected here. Section 2 limits Content and Services licenses and unauthorized exploitation; section 4 forbids cheating, unauthorized tampering and automation, including “non-human-controlled systems”. This service relies on the specific Web API license for user-initiated metadata queries, not scraping, gameplay automation or redistribution of mod binaries. Section 6 grants UGC rights to Valve; it does not independently grant Paperboard unrestricted rights to republish Workshop content. Game-specific terms and author rights continue to apply. Do not expand this service into bulk harvesting or downloads on the strength of this review.

[Steam branding guidelines](https://partner.steamgames.com/doc/marketing/branding) prohibit implied endorsement, prominent branding on non-Valve materials, and modified/unapproved logos. They specify legal attribution when using the logo. The current [community API documentation](https://steamcommunity.com/dev) discusses branding and OpenID buttons but does not prescribe the exact phrase **Powered by Steam** for this use. We include that text and a Steam link conservatively; clients must display it, the non-affiliation notice, and the data disclaimers with results. Metadata alone does not satisfy a future UI's display obligations. If adding a logo, follow the approved artwork, registered mark and legal attribution requirements; this Worker adds no logo.

No numerical cache TTL or universal maximum personal-data retention period was found in these reviewed documents. The 60-second search and 300-second item/collection TTLs are our choices, not Valve mandates. `cache_max_age_seconds` in QueryFiles controls Steam's own stale results, not our retention permission. Never describe an invented retention period as a Valve requirement.

Before operating publicly:

1. Publish the privacy policy and user-facing terms described above, accurately listing the actual countries where Cloudflare processes/caches data. Standard global Cache API placement does not promise a restricted set of countries; determine and disclose that scope, or change deployment before claiming residency guarantees.
2. Disclose public item metadata, public author Steam IDs and short free-text descriptions in edge caches (up to five minutes of freshness). Public IDs can still be personal data. This app does not retrieve profiles, email, real names, passwords, private subscriptions or a caller's Steam ID. Do not enrich author IDs or collect nonpublic user data without a separate review and the required request/disclosures.
3. Disclose client IP processing by Cloudflare for abuse prevention. This Worker stores no IP/request history itself; the rate-limit binding processes IPs. Disable request/subrequest tracing and any external log drains that capture Steam URLs or request bodies. Confirm provider retention and cache eviction behavior in the operator policy: TTL limits serving freshness, not guaranteed physical deletion from Cloudflare infrastructure.
4. Keep the key confidential and dedicate its upstream usage to this service. Coordinate any other key/account usage within Valve's total cap; the local guard cannot count unrelated applications. Do not reset the durable budget name, storage or migration while calls remain in its rolling window. When changing keys, retain the conservative guard rather than resetting it.
5. Preserve attribution, disclaimers and source links when integrating the panel. Handle explicit API errors visibly. Re-review Valve's terms periodically and stop when access is withdrawn.

### Endpoints

Only GET is accepted. No permissive CORS headers are emitted; panel services call server-side. Unknown paths/games return 404; unknown/duplicate parameters and invalid values return 400; other methods return 405 with `Allow: GET`.

- `/modscan/v1/{game}/search?q=&page=&sort=`: optional query (trimmed, at most 200 UTF-16 units, no control characters), page 1–1000 (default 1), sort `relevance` (default), `subscriptions`, or `updated`. Fixed 20 results, English Steam defaults. No arbitrary tags, app IDs, hosts, methods or other Steam parameters.
- `/modscan/v1/{game}/items?ids=123,456`: 1–20 unique, positive uint64 decimal IDs, no leading zeroes.
- `/modscan/v1/{game}/collections/123`: one positive uint64 ID. First checks collection metadata belongs to the selected game, then fetches children. Returns direct children, without recursive traversal. Child/dependency IDs are references; they are not independently looked up or verified as downloadable server mods.

Allowlist verified against Valve pages (no uncertain IDs):

| Slug | Consumer app ID | Source |
| --- | --- | --- |
| tmodloader | 1281930 | [tModLoader Workshop](https://steamcommunity.com/app/1281930/workshop/) |
| garrysmod | 4000 | [Garry's Mod](https://store.steampowered.com/app/4000/) |
| tf2 | 440 | [Team Fortress 2](https://store.steampowered.com/app/440/) |
| cs2 | 730 | [Counter-Strike 2](https://store.steampowered.com/app/730/) |
| palworld | 1623730 | [Palworld Official Workshop](https://steamcommunity.com/app/1623730/workshop/) |

Success JSON is `{ items: Item[], total: number | null, meta: { attribution, source, legal, disclaimer } }`. See the exported `Item` type in `src/index.ts`: ID strings, title (256 units), short description (500), HTTPS preview URL or null, tags (at most 100 of 100 units each), public author ID, subscriptions/favorites or null if Steam omits them, Unix update timestamp, file size in bytes, child/dependency IDs or null if not supplied, and a constructed Workshop URL. `total` is search-only. Free text is untrusted content: render as text, never execute markup. This API does not fetch preview images or mod files. Steam may omit stats/children from its older details endpoint; null means unavailable, never a fabricated zero/empty result. Nonpublic items are rejected even if the key owner can access them. Missing required fields and failed item results fail the whole request explicitly, without partial-success substitution.

Errors are `{ error: { code, message } }`, never cached. Missing secret/binding/cache failures return 503; bad Steam responses/network errors return 502; unavailable/cross-game items return 404; upstream throttling, client limiting and exhausted global budget return distinct 429 codes. Upstream text, URLs containing credentials and exception messages are never returned or logged. Redirects are not followed; timeout is ten seconds and response bodies are bounded to 2 MB.

### Limits and storage

The [Cloudflare rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) allows 60 requests/minute per Cloudflare client IP, including cache hits. This is approximate and per location, not an exact global limiter; shared NATs share a quota. The Worker requires Cloudflare's trusted `CF-Connecting-IP`, never a caller query/header identifying an arbitrary end user. Ensure no upstream Worker overwrites that header.

A single SQLite-backed Durable Object uses transactional storage to reserve every Steam attempt before fetching. The hard cap is 90,000 calls over the current hour plus 24 preceding hourly buckets, conservatively covering every rolling 24-hour period (up to 25 hours of history). This leaves 10,000 calls of headroom under Valve's published cap and avoids assumptions about Valve's day boundary. Only hour/count pairs persist. Collection misses cost two calls; exhausted requests stop before Steam. Reservations are not refunded on failure. Cache hits cost zero upstream calls. Keep the same singleton name across releases.

[Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) provides transactional consistency. KV read/modify/write counters would race across locations and could exceed the budget, so they are unsuitable. No operator-supplied budget parameter can weaken the cap.

The Cache API stores only successful reshaped responses, with canonical validated keys that exclude secrets/IPs: search 60 seconds, item/collection 300 seconds. It is local to each Cloudflare location, not a global cache. Cache failures fail explicitly rather than silently falling through to Steam. No permanent Steam metadata database exists.

### Local development and operator deployment

From the repository root, install workspace dependencies with `bun install`, then:

```sh
bun run --cwd apps/panelapis test
bun run --cwd apps/panelapis typecheck
bun run --cwd apps/panelapis dev
```

Tests run local workerd via Miniflare, with real cache, rate-limit and durable storage bindings; only outgoing Steam HTTP is mocked. Test storage is ephemeral, and dev persistence lives under `/tmp/paperboard-panelapis-dev`, never the user's `.paperboard`. For dev requests supply a local `CF-Connecting-IP` header. Local secrets belong in an ignored `.dev.vars`, never source control. The test harness uses Miniflare's v4 configuration converter because the installed Wrangler dependency uses Miniflare 5's updated API.

Operator steps below are documentation only; no deployment, secret upload or Cloudflare writes were performed during implementation:

1. Complete the pre-operation terms/privacy steps above and register the correct application/domain with Valve. Confirm that a normal Web API key can query the chosen games; a live authenticated smoke test was not performed here. Upstream access denial is explicit and must be resolved with Valve, never worked around.
2. Authenticate Wrangler to the intended Cloudflare account; confirm the `ariapis.com` zone and that `panels.ariapis.com` has a proxied DNS record/origin. The config uses the path route `panels.ariapis.com/modscan/*`, not a host-wide custom domain. Other paths can serve other applications.
3. Confirm rate-limit namespace `1281930` is unique in the account (change before first deployment if necessary). The first deployment migration creates the SQLite Durable Object; remote bindings are not used locally.
4. Set the Worker secret named `STEAM_WEB_API_KEY` securely through the Cloudflare dashboard for Worker `panelapis`; never put its value in `wrangler.jsonc`, shell history, a URL shared with users or Git. Missing configuration produces a clear 503. No secret-setting command is run by these scripts.
5. When separately authorized to publish, run `bun run --cwd apps/panelapis deploy`. Verify routing, attribution, privacy disclosures, cache behavior and visible failures before integrating any panel.

### Emailing Valve about growth

Write to webapi@valvesoftware.com before exceeding the published limit. Include the owner/company contact, Steam account identity (not passwords or the secret key), Paperboard repository and product URLs, registered domain and endpoint, a description of the open-source desktop dashboard and its small current user base, the shared-backend architecture, the exact interfaces/methods and allowlisted game IDs, observed daily/peak call volume and projected growth, requested daily and burst limits, cache TTLs/hit rates, client limits and transactional global budget, privacy/storage countries and retention practices, attribution screenshots/text and user-facing disclaimers. Ask for written confirmation of this backend use, any additional caching/branding/privacy constraints, and the approved new quota/day boundary. Keep the existing cap until Valve approves; an email request itself does not raise it. Do not send the secret API key in email.
