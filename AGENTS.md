# AGENTS.md — Paperboard engineering rules

This file is the review process. Most of this code is built by agents, so these rules are the only consistency that exists between sessions. You must follow them every time, on every task, with no exceptions, including for small fixes, prototypes, and "temporary" code. If you believe a rule is wrong for a change, say so in the PR description and ask — never violate it silently.

## The product

Paperboard is a dashboard for self-hosted programs. Panels are the apps. Optimize for the thousandth panel, not the first.

## Trust model — don't fight it

- Panels are **reviewed, not sandboxed**. A reviewed panel is trusted like first-party code. This is a design decision. Never add sandbox plumbing or "harden" panels by distrusting them.
- What makes review meaningful is the **registry and the manifest**. Panels declare `permissions` in their manifest; review checks what they use against what they declare.
- Secrets (bot tokens, API keys) never go in panel config files or injected payload. They go through the daemon secret vault (Credentials API: `papercrane/credentials.ts`, `secretsApi` in PaperAPI), always with the panel id explicit. `secrets:list` returns names only. A panel that stores a secret in plaintext config does not get released.
- `known-vulnerabilities.md` is a record of accepted trust-model gaps. Never add entries; close them.

## Hard rules

**No silent failure.** Never write `catch {}`. Every catch logs (even `logger.debug`), rethrows, or returns a typed error. Code that continues after failing quietly is the single worst thing you can write here.

**No shell strings from input.** Spawn processes with argv arrays (`execFile`/array `spawn`), never `sh -c` with interpolated values, never quote-stripping as escaping. A shell is only allowed when running a command is the panel's stated product (a terminal, a "run command" action), it is declared as a permission in the panel manifest, and the command is either static text from the flow author or validated.

**Explicit identity everywhere.** Every config, file, action, and trigger call passes an explicit panel id. No hostname parsing as identity, no `process.env` fallbacks, no ambient-scoped transports, no writing identity back to `process.env`, no registering action names that another panel can collide with (key handlers by `panelId:action` in new code).

**Bounded everything.** No unbounded maps, no timers that outlive their object, no broadcast to every socket when a subscription would do, no downloads without a size cap, no registry lookups that iterate everything. Every Set/Map/Timer must have a teardown path.

**Validate at the boundary.** One check at the service that owns the resource. UI-layer checks don't count.

**Separate trust decisions.** Checksums, download URLs, and install manifests are separate facts with separate sources. Never accept a checksum from the same record that demands you trust the download. If a registry lookup fails, refuse the install — never proceed with `sha256: undefined`.

**No dead links in UI styling.** Use `--paper-*` tokens from PaperUI; if a token doesn't exist, add it there rather than hardcoding a hex. No global selectors (`*`, bare `:disabled`) escape `.paperui-root`. No component ships a workbench/demo file in its package `files`.

**Manifests and version numbers tell the truth.** If the manifest declares a permission, the code must use it. If the version says `1.0.0`, the thing is finished. A half-finished panel is `0.x`, never `1.0.0`. A trigger must do exactly what its id says — a trigger that fires on everything is deleted, not shipped.

**Changelogs are suspended.** Do not create, recreate, or edit `CHANGELOG.md` files in any repo. Two rounds of audits caught claims-vs-code drift as the top defect class; until the truth-hygiene revamp, silence is the honest record. Version numbers and manifests still make promises.

## For this repo only (agent workflow)

- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff`, never `checkpoint`. If a change is too big for one commit, make multiple real commits.
- Tests run before you say done. Pure logic without a test needs a one-line reason in the PR.
- Keep the workspace clean: no logs, build outputs, `*.tsbuildinfo`, empty dirs, or generated files anywhere in or next to a repo root.
- Legacy/fallback code needs `TODO(remove after vX)` and dies in one release.

## Fix discipline — how fixes land (tough rules)

- **A fix ships with its proof.** A behavioral change without a test that fails without it is not a fix — it's a claim. If nothing is testable, run the gate grep for the defect class and cite the zero in the PR. "It's fixed" without evidence doesn't merge.
- **A fix closes its own record.** If your fix contradicts a comment, the comment changes in the same commit. If it closes something in `known-vulnerabilities.md`, the entry is deleted in the same commit. A fix that leaves the record disagreeing with the code is a new lie.
- **One invariant, one implementation.** If a security/validation invariant exists twice (mirrors, "same logic in two files"), you either extract to one module with shared tests or you haven't fixed it. Mirroring is how polarity drift starts.
- **No half-shipped deprecations.** When a deprecation lands, the loud warning, the `TODO(deny/remove after vX)` marker, AND the enforcement date all land in one commit. A deprecation with no deadline is a decoration.
- **Manifest fields are honored or deleted.** A validated manifest field the code ignores is a lie per these rules — wire it or remove it from the validator.
- **Destructive boundaries are recoverable.** Installs, uninstalls, vault purges: rename-to-trash before delete; refuse before destroy. Irreversible destruction on a single RPC is a bug even if the UI confirms.
- **Don't run audit loops.** Audits are owner-requested events, not a standing workflow. Fix the listed items, run the gate, stop. Do not re-audit, do not spawn persona reviewers, do not invent the next ten tasks yourself unless asked.

## Scope-token policy (the migration)

- **Identity is granted, never ambient.** Panel tokens carry a `panelId` claim issued at spawn/injection; the vault and any per-panel resource derive the caller's panel from the token claim, not from a parameter. A parameter that disagrees with the claim logs loudly and is tombstoned to *deny after v3.2* — deprecation now, enforcement at registry-open.
- The session's master token (`PAPERCRANE_TOKEN`, daemon host) is not panel equipment: panel services get `PAPERCRANE_PANEL_TOKEN`; broadening a credential's reach in any code path is rejected.
- Permission *enforcement* (deny undeclared) stays gated behind the registry-opening milestone — until then, scoped tokens carry claims and log mismatches; they do not break existing flows.

## The approval test

While working on anything, keep asking two questions at every decision point:

1. **Would Tails approve the engineering?** Would the mechanism actually work as intended in the failure cases, is the boundary validated, is the resource bounded, would the wiring survive a thousand panels? He audits the machine, not the marketing.
2. **Would Steve approve the product?** Does this make the customer's experience simpler or more cluttered, does the version number/changelog tell the truth, are we shipping half a thing under the Paperboard name, did we cut what should be cut?
Be stubborn enough to actually stop yourself if you start writing low confidence code or stop and tell the user if they're sure they want to implement something.

If the answer to either is no, fix the approach — do not ship past it.

## Existing code that is wrong — pattern, don't copy

These are known defects being fixed. Treat them as the opposite of reference material:

- `PaperAPI/src/ws.ts` ambient credential scope (`ambientScope()` hostname parsing) and Electron-shim channel translation — pre-namespaced dispatch, tombstoned, dies with scoped tokens
- `dev.paperboard.actions` flows stored with wildcard `*` panelId — deprecated with a loud warning, hard-removed in v3.1 (`TODO(remove after v3.1)`)

Touching one of these files means fixing it, not matching its style. When fixed, delete the line from this list so the list stays short and true.
