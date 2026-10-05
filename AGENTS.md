# AGENTS.md — Paperboard engineering rules

Mandatory engineering contracts. This file is not evidence that the code obeys them. Most of this project is agent-written: code, comments, tests, and earlier agent reports can all agree and still be wrong. Verify the user-visible contract against the real producer, transport, resource owner, persistence, and consumer. If a requirement conflicts with the requested change, explain the conflict and ask; never silently weaken the requirement or its test.

## A note from the maintainer
Hi, I'm Pxl, and I'm the person that decides whether I want to merge your PRs!!
These rules aren't perfect, and they were admittedly made in a pinch. However, I agree with them and they've boosted Paperboard development so much!!
But they're not completely finite, if you think there's a rule that should be added of removed or changed, that in itself is a PR you can make! :3

Paperboard isn't supposed to be just an app, it should have passion in every corner and I hope that's how you build it.

Good luck devs and agents !

## The product

Paperboard is a dashboard for self-hosted programs. Panels are the apps. Optimize for the thousandth panel, not the first.

Never compromise on: panels are first-party, not sandboxed; the registry is closed and hashes the bytes it hosts; secrets live only in the daemon vault; identity is granted, never ambient.

## Glossary

- **panel**: an installed app (UI plus optional service), identified by a panel id.
- **daemon** (papercrane, crane): the per-computer server that runs panel services and owns their state.
- **host / shell**: the Paperboard app (Electron or browser mode) that shows panels and talks to daemons.
- **computer**: one daemon the shell is paired with; `local` is this machine.
- **registry** (origami): the closed service that hosts panel archives. **library**: its browsing UI.
- **service**: a panel's background process, owned by the daemon.

## Trust model — don't fight it

- Panels are **first-party, not sandboxed**. Never add sandbox plumbing or "harden" panels by distrusting them. There is no "reviewed" badge or review attestation to record: every panel the registry hosts is ours.
- Trust in a panel comes from the **registry**: the closed registry is the only install source, and it hashes the bytes it hosts.
- Secrets (bot tokens, API keys) never go in panel config or injected payload. They go through the vault (`papercrane/credentials.ts`, `secretsApi` in PaperAPI) with the panel id explicit. `secrets:list` returns names only. A panel that stores a secret in plaintext config is not released.
- Accepted trust-model gaps live in a private security ledger, not here. Never add entries; close them.

## Hard rules

**Failure must remain failure.** Never write an empty catch. A catch rethrows or returns a typed failure unless a documented recovery actually succeeded. Logging alone does not authorize returning success, an empty list, default config, or "up to date". Trace failures through the SDK into the UI. Distinguish unavailable from empty, saved from applied, accepted from completed, document-loaded from service-ready. Logger failures go to a non-recursive sink, never back through the failing logger.

**No shell strings from input.** Spawn with argv arrays (`execFile`/array `spawn`); never `sh -c` with interpolated values, never quote-stripping as escaping. A shell is allowed only when running a command is the panel's stated product (a terminal, a "run command" action), and the command is static flow-author text or validated.

**Explicit identity everywhere.** Every config, file, action, and trigger call passes an explicit panel id. No hostname parsing as identity, no `process.env` fallbacks, no ambient-scoped transports, no writing identity to `process.env`, no action names another panel can collide with (key handlers `panelId:action`).

**Bounded everything.** No unbounded maps, no timers that outlive their object, no broadcast to every socket when a subscription would do, no downloads without a size cap, no registry lookups that iterate everything. Every Set/Map/Timer has a teardown path. A per-item cap is not a system budget: bound concurrency, queued bytes, connection/handshake lifetime, extraction size, and fan-out. Respect stream backpressure and cancel both ends on failure. Rotate logs throughout an object's life, not just at construction. Subscribe on the narrowest channel; filtering after a broad broadcast is not scoping.

**Validate at the boundary.** One check, at the service that owns the resource. UI-layer checks don't count.

**Separate trust decisions.** Name the authority for a release, the artifact digest, the download location, and the installed manifest. Publisher URL plus checksum is not independent verification; fetching the same record twice adds no authority. The registry hashes the bytes it hosts: verify them and require archive/request identity agreement before activation. If the authoritative lookup fails, refuse the install. Download origin, publisher, signature, and installed version are different facts; never synthesize one from another.

**No dead links in UI styling.** Use `--paper-*` tokens from PaperUI; if one is missing, add it there, not a hex. No global selectors (`*`, bare `:disabled`) outside `.paperui-root`. No workbench/demo file in a component package's `files`.

**Manifests and versions tell the truth.** `1.0.0` means finished; half-finished is `0.x`. A trigger does exactly what its id says; one that fires on everything is deleted. Validated manifest fields are honored or deleted. The `permissions` array was deleted as unenforced; do not reintroduce it without dispatch enforcement, and no capability badge may imply enforcement that does not exist.

**Changelogs are suspended.** Do not create or edit `CHANGELOG.md` in any repo until the truth-hygiene revamp. Version numbers and manifests still make promises.

## Fix discipline

- **A fix ships with its proof.** A behavioral change needs a regression test of the intended contract that fails without the fix. Names and comments are not proof. Prefer the public path over private fields. For integration defects cross the real boundary (real SDK plus authenticated daemon, pack/publish/install, running child plus stop/update); don't mock away the mechanism that failed. A source grep proves absence of a construct, not runtime behavior.
- **A fix closes its own record.** If it contradicts a comment, change the comment in the same commit. If it closes a private ledger entry, delete the entry in the same commit.
- **One invariant, one implementation.** A security/validation invariant that exists twice is extracted to one module with shared tests, or it isn't fixed.
- **No half-shipped deprecations.** The loud warning, the `TODO(remove after vX)` marker, and the enforcement date land in one commit. Legacy/fallback code needs that marker and dies in one release.
- **Destructive boundaries are observed and transactional.** Stop the owning workload and observe its exit before removing or replacing its resources. A replacement parks the previous bytes only until the new one activates: failure rolls them back in place, success leaves no copy. Uninstall removes code and keeps user data by default; deleting data is an explicit opt-in. Test interruption and failure.
- **Existing tests that expect a defect** are replaced with the intended contract, with an explanation. Never delete, skip, loosen, add retries to, or mock over a failing test to make the gate green.
- **No audit loops.** Audits are owner-requested. Fix the listed items, run the gate, stop. Don't re-audit, spawn reviewers, or invent the next ten tasks.

## Integration contracts — required before saying done

1. **Identity is end to end.** `packages/paperapi/src/panelIdentity.ts` owns panel identifiers; never copy its regex. Pack, publish, routes, manifest validation, and token issuance must agree. Never normalize a rejected identity into an accepted one. Test real first-party dotted ids and reserved names.
2. **Authentication precedes use.** An open socket is not authenticated or ready. RPC, HTTP, DAV, and relays preserve the same principal; a scoped token is not a host token. Relays may narrow identity, never broaden it. Revocation invalidates live sockets and derived sessions. See `papercrane/principal.ts`, `auth.ts`, `ws.ts`, `dav.ts`, `tests/wirePrincipals.test.ts`.
3. **Lifecycle is observed, not inferred.** Service generations own their timers, child, readiness, and completion. Await async init and stop. `ChildProcess.killed` means a signal was sent, not that it exited. A removed record cancels delayed work. No in-process import fallback that can't be stopped or restarted. Update success requires new behavior/readiness. Kill workloads through the ownership ledger, never by name guess.
4. **Persistence has one owner.** Ordinary writes affect only the addressed document. Migrations are explicit, versioned, one-time, recoverable, and never heuristically clean sibling documents. Atomic writes don't solve read-modify-write races. Never treat unreadable state as empty state to overwrite.
5. **An event has defined multiplicity.** Two flows on one event each run once: subscribe by unique event key or dispatch only the subscribed flow. Nested failure propagates to the parent. Recursion state belongs to an execution stack, not a global set.
6. **Test what gets distributed.** Workspace symlinks and source imports hide broken exports. Build and pack shared libraries, then run `node scripts/check-package-artifacts.mjs` against an external consumer. Every declared export target must exist, including conditional and CJS entries. Typechecks don't prove OS or packaged-app support.
7. **UI outcomes are correctness.** Error and degraded states need a visible recovery action. Readiness verifies authenticated service hydration for the current frame generation. Dialogs have accessible names, enabled-only focus traversal, focus return, and working dismissal under reduced motion. Ligature text is not an accessible label. Test semantics in a browser, not just class names.
8. **Hit every surface.** A shared component or style change affects every panel that uses it, so check the callers. A behavior reachable from one entry point is usually reachable from others (menu, settings, keybinding). If you add a way in, add the way out.

## Scope-token policy

- **Identity is granted, never ambient.** Panel tokens carry a `panelId` claim issued at spawn/injection; vault, config, and file resources derive the caller's panel from it. Cross-panel disagreement is refused. Host-issued relay sessions cannot broaden themselves. The registry stays closed to public panel uploads; source publication is a separate decision.
- The master token (`PAPERCRANE_TOKEN`) is not panel equipment: panel services get `PAPERCRANE_PANEL_TOKEN`. Broadening a credential's reach anywhere is rejected.
- Process and terminal ownership is enforced in `rpc/ownership.ts`: a scoped caller cannot touch or re-create another panel's id.

## Working in this repo

**Ways to hurt yourself**
- Never `pkill -f`; your own shell can match. Before stopping a process, verify its owner, executable, and command line, and stop only the workload owned by your task.
- Never touch `~/.paperboard` (the real install). Use a temporary `PAPERBOARD_DIR`, loopback fixtures, and temp dirs. Tests must never find the user's daemon, credentials, registry, or workloads.
- Launching the app from an agent shell: unset `ELECTRON_RUN_AS_NODE`.
- `bun run gate` typechecks, tests, **and rebuilds** panels; the daemon runs the built `dist/service.js`, so the build is the artifact proof. `bun run build:panels` builds panels alone.
- `bun run gate <target...>` runs only those targets (plus the shared-library builds they consume): `bun run gate terminal`, `bun run gate paperapi paperui`, `bun run gate gameserver`. Targets: `packages`, `paperapi`, `paperui`, `paperboard`, `paperconvert`, `paperdocs`, `origami`, `origami-library`, `scripts`, and the panels `actions` `ai` `botcreator` `gameserver` `terminal`. Repo-wide checks (changelog, TODO expiry) run only in the full gate. Editing one panel or library should not force the whole gate.

**Browser (web) mode**
- The shell can run in a real browser instead of an Electron window. Dev launcher: `bun run dev:browser` (from `apps/paperboard`), or `bun scripts/launch.ts dev -- --browser --browser-port=<n>` to pin a port. It prints `Paperboard (browser, DEV TOOL) is running at http://paperboard.localhost:<n>`.
- Agents may use this to view the real shell and panels — good for screenshots and end-to-end checks the Electron window can't easily give a headless session. `*.localhost` resolves to loopback, so `paperboard.localhost:<n>` and `<comp>.<panelId>.paperboard.localhost:<n>` both work.
- Set `PAPERBOARD_NO_BROWSER=1` so the launcher does not try to open a browser (useful headless/over SSH); then open the origin yourself, over an `ssh -L <n>:127.0.0.1:<n>` tunnel if remote.
- **It is a dev tool and has no sign-in.** It binds to `127.0.0.1` only and must never be exposed on a network interface; the Host check (DNS rebinding) and the shell bridge's exact-Origin check are the only remaining boundary. Treat browser mode like an open local daemon: development on a trusted, single-user machine.
- It reads the default `~/.paperboard` install unless you pass a temporary `PAPERBOARD_DIR`; for agent work, point `PAPERBOARD_DIR` at a temp dir so you never touch the real install.


**Git**
- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff` or `checkpoint`.
- One concern per commit; a too-big change is several real commits. Commit each finished change as it lands, so files don't mix unrelated work.
- Keep the workspace clean: no logs, build outputs, `*.tsbuildinfo`, empty dirs, or generated files in or beside a repo root.

**Done means**
- Start with a finite checklist of the requested defects. Read the full failing path before editing; state what owns the invariant and what evidence will establish it. Keep unrelated strategy, licensing, and features out of bug fixes.
- Run targeted tests while working, then `bun run gate` plus any packed-artifact or browser check that applies. A command exiting 0 is not proof; read its output. Pure logic without a test needs a one-line reason.
- Test data, listeners, children, and servers are torn down even when assertions fail.
- The final report separates implemented and verified from unfinished or unverified. Don't tick a checklist item because code was written, and don't call a ledger entry closed until its whole path is proven.
- Commentary is for findings and decisions, not deliberation or routine tool narration.

## The approval test

At every decision point ask:

1. **Would Tails approve the engineering?** Does the mechanism work in the failure cases, is the boundary validated, is the resource bounded, does the wiring survive a thousand panels? He audits the machine, not the marketing.
2. **Would Steve approve the product?** Simpler or more cluttered for the customer? Do the version and manifest tell the truth? Are we shipping half a thing under the Paperboard name? Did we cut what should be cut?

If either answer is no, fix the approach. Be stubborn enough to stop and tell the user if you catch yourself writing low-confidence code or if they may not want what they asked for.

## Existing code that is wrong — pattern, don't copy

Known defects being fixed; treat them as the opposite of reference material. No entries now. When recording an owner-requested fix, name the actual failure and its acceptance test; don't copy the defective implementation as precedent. Touching a listed file means fixing it; when fixed, delete its line.
