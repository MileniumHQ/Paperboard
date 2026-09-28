# AGENTS.md — Paperboard engineering rules

This file defines mandatory engineering contracts. It is not evidence that the code obeys them. Most of this project is agent-written: existing code, comments, tests, and previous agent reports may all agree with each other and still be wrong. Verify the user-visible contract against the actual producer, transport, resource owner, persistence, and consumer. If a requirement conflicts with the requested change, explain the conflict and ask; never silently weaken the requirement or its test.

## The product

Paperboard is a dashboard for self-hosted programs. Panels are the apps. Optimize for the thousandth panel, not the first.

## Trust model — don't fight it

- Panels are **reviewed, not sandboxed**. A reviewed panel is trusted like first-party code. This is a design decision. Never add sandbox plumbing or "harden" panels by distrusting them.
- What makes review meaningful is the **registry and the manifest**. Panels declare network egress in their manifest; review checks declared hosts against what they actually fetch, and checks API use against the panel's stated product.
- Secrets (bot tokens, API keys) never go in panel config files or injected payload. They go through the daemon secret vault (Credentials API: `papercrane/credentials.ts`, `secretsApi` in PaperAPI), always with the panel id explicit. `secrets:list` returns names only. A panel that stores a secret in plaintext config does not get released.
- Accepted trust-model gaps are recorded in a private security ledger, not in this repository. Never add entries; close them.

## Hard rules

**Failure must remain failure.** Never write an empty catch. A catch must rethrow or return a typed failure unless a documented recovery actually succeeded. Logging alone does not authorize returning success, an empty list, default configuration, or "up to date". Trace the failure through the SDK into the UI. Distinguish unavailable from empty, saved from applied, accepted from completed, and document-loaded from service-ready. Logger failures go to a non-recursive sink, never back through the failing logger.

**No shell strings from input.** Spawn processes with argv arrays (`execFile`/array `spawn`), never `sh -c` with interpolated values, never quote-stripping as escaping. A shell is only allowed when running a command is the panel's stated product (a terminal, a "run command" action — plain from name, description, and service), and the command is either static text from the flow author or validated.

**Explicit identity everywhere.** Every config, file, action, and trigger call passes an explicit panel id. No hostname parsing as identity, no `process.env` fallbacks, no ambient-scoped transports, no writing identity back to `process.env`, no registering action names that another panel can collide with (key handlers by `panelId:action` in new code).

**Bounded everything.** No unbounded maps, no timers that outlive their object, no broadcast to every socket when a subscription would do, no downloads without a size cap, no registry lookups that iterate everything. Every Set/Map/Timer must have a teardown path.

A per-item cap is not a system budget. Bound concurrency, queued bytes, connection/handshake lifetime, extraction size, and fan-out. Respect writable-stream backpressure and cancel both stream ends on failure. Run log rotation throughout the object's lifetime, not just construction. Subscription APIs must use the narrowest channel available; filtering after a broad broadcast is not subscription scoping.

**Validate at the boundary.** One check at the service that owns the resource. UI-layer checks don't count.

**Separate trust decisions.** Name the trusted authority for a release, the artifact digest, the download location, and the installed manifest. Publisher-supplied URL + checksum is not independent verification; fetching the same record twice creates no new authority. The closed registry hashes the bytes it hosts. Verify those bytes and require archive/request identity agreement before activation. If the authoritative lookup fails, refuse the install. Download origin, publisher name, signature, review attestation, and installed version are different facts: never synthesize one from another.

**No dead links in UI styling.** Use `--paper-*` tokens from PaperUI; if a token doesn't exist, add it there rather than hardcoding a hex. No global selectors (`*`, bare `:disabled`) escape `.paperui-root`. No component ships a workbench/demo file in its package `files`.

**Manifests and version numbers tell the truth.** If the version says `1.0.0`, the thing is finished. A half-finished panel is `0.x`, never `1.0.0`. A trigger must do exactly what its id says — a trigger that fires on everything is deleted, not shipped. The `permissions` array was deleted as unenforced ceremony (network egress stays declared and CSP-enforced) — do not reintroduce it without dispatch enforcement.

**Changelogs are suspended.** Do not create, recreate, or edit `CHANGELOG.md` files in any repo. Two rounds of audits caught claims-vs-code drift as the top defect class; until the truth-hygiene revamp, silence is the honest record. Version numbers and manifests still make promises.

## For this repo only (agent workflow)

- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff`, never `checkpoint`. If a change is too big for one commit, make multiple real commits.
- Tests run before you say done. Pure logic without a test needs a one-line reason in the PR.
- Keep the workspace clean: no logs, build outputs, `*.tsbuildinfo`, empty dirs, or generated files anywhere in or next to a repo root.
- Legacy/fallback code needs `TODO(remove after vX)` and dies in one release.

## Fix discipline — how fixes land (tough rules)

- **A fix ships with its proof.** A behavioral change requires a regression test of the intended contract that fails without the fix. Test names and comments are not proof. Prefer the public path over private fields. For an integration defect, cross the actual boundary: real SDK + authenticated daemon, pack + publish + install, or running child + stop/update. Do not mock away the mechanism that failed. A source grep can prove absence of a construct, not correctness of runtime behavior.
- **A fix closes its own record.** If your fix contradicts a comment, the comment changes in the same commit. If it closes something in the private security ledger, the entry is deleted in the same commit. A fix that leaves the record disagreeing with the code is a new lie.
- **One invariant, one implementation.** If a security/validation invariant exists twice (mirrors, "same logic in two files"), you either extract to one module with shared tests or you haven't fixed it. Mirroring is how polarity drift starts.
- **No half-shipped deprecations.** When a deprecation lands, the loud warning, the `TODO(deny/remove after vX)` marker, AND the enforcement date all land in one commit. A deprecation with no deadline is a decoration.
- **Manifest fields are honored or deleted.** A validated manifest field the code ignores is a lie per these rules — wire it or remove it from the validator.
- **Destructive boundaries are recoverable.** A rename followed immediately by recursive deletion is not recovery. Retain the previous usable bytes until a separate, explicit retention/purge decision. Uninstall retains user data by default. Stop the owning workload and observe its exit before removing or replacing its resources. If staging a recovery copy fails, refuse destruction. Test actual restore after success, interruption, and failure. Vault recovery stays owner-only and inaccessible to ordinary file/DAV surfaces.
- **Don't run audit loops.** Audits are owner-requested events, not a standing workflow. Fix the listed items, run the gate, stop. Do not re-audit, do not spawn persona reviewers, do not invent the next ten tasks yourself unless asked.

## Integration contracts — required before saying done

1. **Identity is end to end.** `packages/paperapi/src/panelIdentity.ts` owns panel identifiers. Do not copy its regex. Pack, publish, routes, manifest validation and token issuance must agree. Never normalize a rejected identity into a different accepted one. Test real first-party dotted IDs and reserved names.
2. **Authentication precedes use.** A socket being open is not authenticated or ready. RPC, HTTP, DAV and remote relays must preserve the same principal. A valid scoped token is not a host token. Relays may narrow identity, never substitute broad authority. Revocation invalidates live sockets and derived sessions, not just future handshakes. See `papercrane/principal.ts`, `auth.ts`, `ws.ts`, `dav.ts`, and `tests/wirePrincipals.test.ts`.
3. **Lifecycle is observed, not inferred.** Service generations own their timers, child, readiness and completion. Await asynchronous initialization and stop. `ChildProcess.killed` means a signal was sent, not that the process exited. A removed record must cancel delayed work. No in-process import fallback that cannot be stopped or freshly restarted. Update success requires new behavior/readiness; rollback must preserve the previous release. Kill workload IDs through the ownership ledger, not naming guesses.
4. **Persistence has one owner.** Ordinary writes affect only the addressed document. Migrations are explicit, versioned, one-time, and recoverable; they must not run heuristic cleanup of sibling documents. Atomic writes do not solve read-modify-write races. Never treat unreadable state as an empty state to overwrite.
5. **An event has defined multiplicity.** Two flows listening to one event each execute once. Subscribe by unique event key or dispatch only the subscribed flow. Nested failure propagates to the parent. Recursion state belongs to an execution stack, not a global set that rejects unrelated concurrent calls.
6. **Test what gets distributed.** Workspace symlinks and source imports can conceal broken exports. Build and pack shared libraries, then run `node scripts/check-package-artifacts.mjs` against an external consumer. All declared export targets must exist, including conditional and CJS entries. Do not infer OS or packaged-app support from typechecks.
7. **UI outcomes are part of correctness.** Error and degraded states need a visible recovery action. Readiness must verify authenticated service hydration for the current frame generation. Dialogs have accessible names, enabled-only focus traversal, focus return, and working dismissal under reduced motion. Icon ligature text is not a useful accessible label. Test semantic behavior in a browser, not only CSS class names.

### Agent execution protocol

- Start with a finite checklist of the requested defects and the relevant public contracts. Keep unrelated product strategy, licensing and new features out of bug-fix work.
- Read the full path that causes each failure before editing. State what owns the invariant and what evidence will establish it.
- Keep one implementation of each invariant. Reuse a shared helper only when callers truly share the same semantics and authority.
- If an existing test expects the defect, replace its expectation with the intended contract and explain why. Do not delete, skip, loosen, add retries to, or mock over a failing test merely to make the gate green.
- Test data, listeners, spawned children and servers need teardown even when assertions fail. Never let tests discover the user's live daemon, credentials, registry or workloads. Use temporary directories and loopback fixture servers.
- Run targeted regression tests while working, then `bun run gate` and any relevant packed-artifact/browser checks. Inspect failures; a command exiting successfully is not proof if its child results or output say otherwise.
- In the final response, distinguish implemented and verified from unfinished or unverified. Do not mark a checklist item complete because code was written. Do not claim a security ledger entry closed until the entire described path is proven.
- Use commentary for concise findings and decisions. Do not narrate private deliberation, token budgets, speculative plans, or routine tool operations.

## Scope-token policy

- **Identity is granted, never ambient.** Panel tokens carry a `panelId` claim issued at spawn/injection; vault, configuration and file resources derive the caller's panel from that claim. Cross-panel disagreement is refused. Host-issued scoped relay sessions cannot broaden themselves. The registry remains closed to public panel uploads; source publication is a different decision.
- The session's master token (`PAPERCRANE_TOKEN`, daemon host) is not panel equipment: panel services get `PAPERCRANE_PANEL_TOKEN`; broadening a credential's reach in any code path is rejected.
- Process and terminal ownership is enforced in `rpc/ownership.ts`: a scoped caller cannot touch or re-create another panel's id. The `permissions` array remains deleted. No manifest capability badge may imply dispatch enforcement that does not exist.

## The approval test

While working on anything, keep asking two questions at every decision point:

1. **Would Tails approve the engineering?** Would the mechanism actually work as intended in the failure cases, is the boundary validated, is the resource bounded, would the wiring survive a thousand panels? He audits the machine, not the marketing.
2. **Would Steve approve the product?** Does this make the customer's experience simpler or more cluttered, does the version number/changelog tell the truth, are we shipping half a thing under the Paperboard name, did we cut what should be cut?
Be stubborn enough to actually stop yourself if you start writing low confidence code or stop and tell the user if they're sure they want to implement something.

If the answer to either is no, fix the approach — do not ship past it.

## Existing code that is wrong — pattern, don't copy

These are known defects being fixed. Treat them as the opposite of reference material:

- No entries. When recording a newly owner-requested fix, name the actual failure and its acceptance test; do not copy the defective implementation as a precedent.

Touching one of these files means fixing it, not matching its style. When fixed, delete the line from this list so the list stays short and true.
