# Origami

Cloudflare Worker package registry for Paperboard.

## Endpoints (`origami.ariapis.com`)

Every route is read-only; records are written by the operator scripts below, never by a request.

- **`GET /`** and **`/health`**: service info and the route list.
- **`GET /package/:name.json`**: one package record from the `PACKAGES` KV namespace (e.g. `/package/java-26.json`).
- **`GET /package/index.json`**: every package record, keyed by name. A registry holding more than 200 packages answers 500 instead of a partial map.
- **`GET /panels/index.json`**: every listed panel record, keyed by id. **`GET /panel/:id.json`** is one record (unlisted ones included), **`/panel/:id/download`** serves its archive, **`/panel/:id/icon`** and **`/panel/:id/media/:version/:file`** serve its icon and store screenshots.
- **`/library/`**: the panel library (below).

A record that exists but can't be read answers 500 naming it, never 404.

## Panel library (`/library/`)

The panel library is a division of this origin, not part of the Paperboard window: a Solid + PaperUI web app under `library/`, built to `library/dist` and served as static assets from the same origin as `/panels/index.json`. It reads the registry directly and downloads archives from `/panel/:id/download`; no separate API exists for it.

When it runs inside Paperboard's iframe, the shell completes a postMessage handshake and the install action becomes a signal round-trip (the shell performs the daemon install and answers with the result). Opened directly in a browser, it never handshakes and the action is a plain archive download. `bun run build:library` is part of `dev` and `deploy`; the library's own suite runs with `bun run test:library`.

## Downloads (`i.paperboard.dev`)

Binaries live on GitHub Releases; Origami only 302-redirects to them, and serves the small updater feeds and checksums from R2. A KV version database (`dl/pb`, `dl/crane` in the `PACKAGES` namespace) is the source of truth: unknown versions and unrecorded files are 404s.

- **`GET /`**: the install script. `curl -fsSL https://i.paperboard.dev | sh` gets `install.sh`, and a browser is sent to the downloads page. PowerShell, at `/` or `/install.ps1`, gets a 410 that points to the Windows installer (there is no pipe-to-PowerShell install, which looks like a ClickFix attack). **`/install.sh`** names the script directly; it comes from `packages/npx/install`.
- **`GET /pb/SHA256SUMS`**: the checksums the install scripts verify against.
- **`GET /pb/latest/:file`** and **`GET /crane/latest/:file`**: redirect to the current release asset (not cached).
- **`GET /pb/:version/:file`** and **`GET /crane/:version/:file`**: redirect to that version's asset (immutable, cached). Previous versions keep working.
- **`GET /pb/latest.yml`**, **`/pb/latest-mac.yml`**, **`/pb/latest-linux.yml`**, **`/pb/latest-linux-arm64.yml`**: electron-updater feeds.
- Everything else on this host, the registry and panels included, is a 404.

On the main host the release routes and feeds live under `/paperdl/` (`/paperdl/pb/…`, `/paperdl/crane/…`), with `/paperdl/:app/index.json` for the host updater; the install scripts and `SHA256SUMS` are on `i.paperboard.dev` only. The old `/paperdl/paperboard/…` feeds and `/paperdl/:app/:target/download` paths still answer (the downloads 302 to the canonical latest file) so existing installs keep updating.

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

Panels are published by the operator, not by a worker route: `bun run publish` in the repo root (Publish panels) writes the archive, icon, store media, `panel:<id>` record, and `panels:index` straight to production through `wrangler`, using the same Cloudflare login as the package updaters. There is no registry key and no `/panel/publish` endpoint. Record URLs are baked from the canonical production origin, so a local `wrangler dev` cannot store production URLs.

## Package records

Package records (`java-<N>`, `ollama`, `helium`, `steamcmd`, `proton`, `opencode`, `codex`, `claude-code`) are written by operator scripts, never by a worker route. They write straight to the production `PACKAGES` namespace through wrangler, so sign in first with `bunx wrangler login`. A record identical to the one the registry already serves is skipped (`unchanged <name>`), so the updaters are safe to run on a schedule.

```bash
# every Adoptium feature release (or name them: -- 21 25)
bun run update:java

# latest stable Ollama release
bun run update:ollama

# latest stable Helium release (all three imputnet repos, same version)
bun run update:helium

# pinned Valve SteamCMD bootstraps (all three x64 platforms)
bun run update:steamcmd

# latest .NET runtime of each published channel (dotnet-8)
bun run update:dotnet

# latest stable standalone GE-Proton (Linux x64 and arm64)
bun run update:proton

# newest stable OpenCode 2.x release
bun run update:opencode

# latest stable Codex release (downloads every archive to check its contents)
bun run update:codex

# Claude Code from Anthropic's stable channel (or --channel latest); needs gpg
bun run update:claude-code

# print the records without writing
bun run update:ollama -- --dry-run
bun run update:steamcmd -- --dry-run
bun run update:proton -- --dry-run
```

Every platform entry carries a `sha256` from the upstream authority (Adoptium's API, GitHub's asset digest cross-checked against `sha256sum.txt`). A platform without one fails the whole record, and the record already served stays. The daemon refuses to install without it. `layout` tells the daemon how the archive maps onto the package directory: `wrapped` (default, one top-level folder around `bin/`), `root` (archive root holds `bin/`), or `bin` (archive root *is* `bin/`).

A package Paperboard does not host carries a `recipe` instead of a `layout`: data the daemon runs on the user's computer after checking the download, never a script. `unpack` is one of `zip`, `tar`, `tar.xz` (needs the system's `xz`) or `dmg` (macOS only; mounted read-only, copied out with `ditto`), and `take` maps package paths to paths in the unpacked tree, for example `{ "unpack": "dmg", "take": { "bin/Helium.app": "Helium.app" } }`. The release signature covers the recipe, so daemons from before recipes refuse such an entry instead of installing it unpacked. See `packages/release/src/recipe.ts`.

SteamCMD uses Valve's CDN bootstraps, with SHA-256 pins reviewed in `scripts/update-steamcmd.ts` because Valve publishes no checksums. The updater downloads all three and refuses the entire record if any pin changes. Its version, `2020.04.02`, is the newest pinned bootstrap date, not the runtime version. Recipes preserve the archive-root files under `bin/`. Only Linux, macOS and Windows x64 are advertised; Valve supplies no Linux/Windows arm64 bootstrap, and the x86-only macOS build does not establish Rosetta availability on an arm64 host. Linux SteamCMD is 32-bit and requires the host's 32-bit libc (`lib32-glibc` or `libc6-i386`). SteamCMD self-updates into its own directory: the Game Server consumer must copy and run the bootstrap from a mutable workspace, never the installed package directory.

`dotnet-<major>` is Microsoft's portable .NET runtime from `builds.dotnet.microsoft.com`, for game servers built on .NET (tModLoader pins 8.0 with roll-forward disabled). The updater reads the channel's `releases.json`, takes its latest runtime, downloads each archive and refuses the whole record if any SHA-512 differs from Microsoft's metadata; the recorded SHA-256 is computed from those verified bytes. Each recipe keeps `dotnet`, `host/` and `shared/` together under `bin/`, since the host finds `host/fxr` beside itself, plus the license files at the package root. Linux and macOS x64/arm64 and Windows x64 are published; Windows arm64 has no certified consumer. The archives contain no symlinks.

`proton` tracks `GloriousEggroll/proton-ge-custom`, the standalone GE-Proton build usable without the Steam client (Valve's Proton ships through Steam). Its version is the stable `GE-ProtonX-Y` tag. Only Linux x64 and arm64 are supported; each recipe takes the release's top-level `GE-ProtonX-Y-<arch>` directory into `bin/`, preserving its relative links and executable modes. GitHub's SHA-256 asset digest is authoritative. The updater downloads and validates each matching `.sha512sum` file's checksum syntax and archive name, but cannot cross-check that SHA-512 against a SHA-256 without downloading the large archive. Installation checks the actual download against the recorded SHA-256. Missing assets, digests or checksum companions, drafts, prereleases and unexpected tags fail the entire record.

The Agent panel's three CLIs are packages too, none of them hosted by Paperboard; each platform entry points at the vendor's own download and carries the recipe or layout that installs it. Every platform of each record must resolve, or nothing is written.

`opencode` tracks the 2.x line of `anomalyco/opencode`. GitHub's `/releases/latest` still points at the old 1.x line, so the updater lists the recent releases and takes the newest stable `v2.x.y` tag. Each archive holds a single `opencode` (`opencode.exe`) at its root, so the entry uses `layout: "bin"`. x64 ships the `-baseline` build on every OS, which runs on CPUs without AVX2; the `-musl` builds do not run on glibc and are never used, so Alpine is unsupported. GitHub's SHA-256 asset digest must agree with the release's `SHA256SUMS`.

`codex` tracks `openai/codex` (`rust-vX.Y.Z` tags) and installs `codex-package-<triple>.tar.gz`. Only the `.tar.gz` files are listed in the release's `codex-package_SHA256SUMS`, which GitHub's digest must agree with. The Linux builds are static musl and run on any distribution. The recipe takes `bin/`, `codex-package.json` and `codex-path/`, plus what each OS adds under `codex-resources/`: `bwrap` on Linux, the two Windows sandbox helpers on Windows, nothing on macOS. It leaves out `codex-resources/voice/` (about 50 MB). Because a recipe that names a missing path would only fail on a user's computer, the updater downloads all six archives, checks each against its digest, lists it with `tar -t`, and refuses the record if any `take` source is absent. Nothing in an archive is extracted or run.

`claude-code` installs Anthropic's per-platform npm packages (`@anthropic-ai/claude-code-<platform>`, plain tarballs without install scripts) holding the unmodified binary and its `LICENSE.md`. The version is read from `downloads.claude.ai/claude-code-releases/stable`. The updater requires Anthropic's `manifest.json` to verify against its detached GPG signature, using the key at `downloads.claude.ai/keys` in a throwaway keyring and only if the signing key's primary fingerprint is the one pinned in `scripts/update-claude-code.ts`, so `gpg` must be installed. It then downloads each tarball and requires its sha512 and sha1 to match the registry's `dist.integrity` and `dist.shasum`, and the sha256 of the binary inside it to match the signed manifest. The recorded SHA-256 is the tarball's own. Linux is glibc only: Anthropic publishes separate musl builds, but a record has no libc dimension.

## Configuration

`wrangler.jsonc` binds the `PACKAGES` KV namespace (package records, panel records, `panels:index` and the `dl/*` version database), the `PANELS_BUCKET` R2 bucket (panel archives, icons and store media) and the `PAPERDL_BUCKET` R2 bucket (updater feeds, `SHA256SUMS` and the `paperdl` indexes). It also serves `library/dist` as static assets on the same origin.
