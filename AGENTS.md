# AGENTS.md

Hi agents, Pxl here! I'm the dev you're probably working with.

**Try your changes yourself in the app or browser mode before shipping—make sure they look good, work well, and have clean code.**

Read [CONTRIBUTING.md](CONTRIBUTING.md) too before you open a PR.

Paperboard is a dashboard for self-hostable programs. Panels are like the apps. Here's some rules:

- **Optimize for a thousand panels:** Paperboard is an SDK at heart. Never hard-code panel-specific logic or narrow global APIs (a few legacy exceptions exist; don't add more).
- **Panel trust:** Panels are reviewed and first-party, so they aren't sandboxed. Don't add sandboxing if a panel can easily do the same thing another way.
- **Secrets:** Never commit secrets, and store runtime secrets with Paperboard's secrets API.
- **App keys:** Put third-party keys (like Google Drive OAuth) in gitignored `apps/paperboard/.env.local` and Actions secrets; release builds refuse to start without `APP_KEYS` (`scripts/publish/publishLib.ts`).
- **Privacy & outbound services:** `apps/paperdocs/src/site/pages/privacy.md` only lists Paperboard's own services and backup providers; panel outbound services go in each panel's `manifest.json` under `store.services`.
- **Fail loudly:** Never swallow errors—use `showError` / `PaperToast` for one-off failures or `PaperError` for standing ones. Gates flag log-only catches; mark intentional catches (cleanup, shutdown, state-shown errors) or non-polling test waits with `// quiet: <reason>`.
- **Don't run remote code:** Never let a panel run code or commands from outside the panel unless directed.
- **Untrusted URLs:** Fetch URLs from model output or other untrusted input in the service with `fetchPublic` instead of loading them directly in a page. Assets from a panel's known services are fine.
- **No weird fallbacks:** Don't invent placeholders when something isn't available—throw an error and handle it.
- **Changelogs are suspended:** No changelogs right now.
- **Nothing ships that is unfinished:** Write production-ready code, not experiments.
- **Old-version code needs a removal date:** if you add code just to support an older version, mark it `TODO(remove after vX.Y)`. The gate fails once that version ships, so it can't be forgotten.
- **Only migrate what users have:** if it never shipped, just change it. No migration code for it.
- **Delete what you replace:** if nothing uses the old code anymore, remove it.
- **Rewrites > band-aids:** Prefer rewriting a messy part over patching around it, and flag when that's needed. Still, if a 5-line fix is genuinely best, take it.
- **Suicide prevention:** Never run `pkill` or `killall` (it can kill your own shell or another session). Stop only PIDs you started.
- **Leave the real app alone:** Never kill the installed Paperboard app or its workloads (game servers, supervisors). If it crashed, check whether a session killed it first.
- **Launching from an agent shell:** `ELECTRON_RUN_AS_NODE=1` crashes Electron—launch with `env -u ELECTRON_RUN_AS_NODE`, a throwaway `PAPERBOARD_DIR`, and `--user-data-dir`.
- When making blocks, placeholders are the type (e.g. `"Text"` or `"Channel ID"`), not example values (e.g. `"Example Text"`, `"1234567890"`).
- **Be careful with deletes:** stop a service before touching its files, and keep user data on uninstall.

Tests:

- **Tests are CI:** deterministic, no network, temp dirs via `PAPERBOARD_DIR`. Real boundaries over mocks.
- **Platform tests:** only OS-dependent tests go in `test/platform`; CI runs those on every release target.
- **Only what matters:** data loss, security, updates/releases, core contracts.
- **Never skip or loosen a failing test.** Fix the code, or the test if it expects broken behavior.
- **Find out why CI failed before rerunning:** if someone else broke (GitHub, apt), rerun. If our code or tests broke, fix it, even if a rerun passes.

*drumroll:* PRs!

When doing work, it's accepted in PRs. Split your work into multiple commits, then post them as a PR upon the user's request, after running relevant gates locally. Fix red CI, or fix the test.

Some rules about Git:

- **Keep the workspace clean:** Only code, assets and markdown in this repo, no logs, builds, etc should end up here.
- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff` or `checkpoint`.
- **Shared checkout:** Other sessions may switch branches mid-task. Check `git branch --show-current` before committing or merging, commit with `git commit -- <paths>` (never `git add -A` or bare `git commit`), never touch others' uncommitted files, and never use `git stash`.
- **Branches:** `company` is only for accounts work (sign-in, Paperboard Cloud, web hosting). Everything else goes to `main`, even if you're sitting on `company`. Merge `main` into `company`, never the reverse, and never push `company`.

**Gates:**

Paperboard has gates relevant to each individual part of the codebase. `bun run gate [target]`

- Apps: `paperboard` (desktop app), `daemon` (server daemon and its Go supervisor), `paperdocs` (docs site)
- Services: `origami` (registry), `library` (panel store), `arilink` (pbd.lc short links), `panelapis` (panel APIs), `issues` (issue reports)
- Packages: `paperapi`, `paperui`, `create-panel`, `npx` (the npx launcher), `release`, `testkit` (the shared test harness), `packages` (the packed libraries as a consumer gets them)
- Panels: `agents`, `blocks`, `botcreator`, `drive`, `gameserver`, `terminal`
- Repo: `scripts` (root scripts), `global` (repo-wide checks), `platform` (the OS-dependent suites CI runs on every release target)

Run them before pushing code. No need to run the full gate unless you're so inclined!

End a PR description with `Gate: <targets>` (e.g. `Gate: paperdocs` or `Gate: terminal paperboard platform`) so CI only runs those targets (`platform` adds the other OS runners). Without a `Gate:` line—and on pushes to `main`—CI runs everything.

Browser mode:

- It's a dev tool, not for being shipped to users.
- `bun run dev:browser`
- Use it for screenshots, testing, browser use in your agent (T3 Code), etc.
- USE THE T3 PREVIEW IF AVAILABLE. If it's not available, use a headless browser (preferrably Helium). **How the UI looks must be held to the highest standard.**

Solid:

- **Rows keep their identity:** a list that reloads lives in a store reconciled by id (or `<Index>`). Never hand `<For>` fresh objects: every row is rebuilt, and a switch that is rebuilt doesn't animate.
- **Never rebuild a view to refresh it:** key a view on an id, never on an object or on `props.children` read again.
- **Read a JSX prop once:** resolve it with `children()`. `<Show when={props.x}>{props.x}</Show>` builds it twice.
- **Props stay reactive:** no destructuring, no `const x = props.x`, no `if`/`switch`/early return on props in a component body.
- **A push that changes nothing notifies nothing:** keep the old value when the new one is equal, and `batch` setters that follow an `await`.
- **Effects track what they mean:** name the dependencies with `on()`. An effect that calls a service must not depend on what that call changes.
- **Late answers lose:** anything async that a newer request can replace carries a token and drops the older answer.
- **One way to save a control:** it flips at once, saves in order, and falls back with an error. Never disable a control for its own save.
- **Stale comments are bugs:** when you remove a mechanism, grep for the comments that cite it.

UI:

- **Use PaperUI, avoid custom components and CSS:** Build with PaperUI components instead of custom components or style tags unless something is genuinely unique (like the Agents text input or Blocks canvas). If PaperUI needs a new or improved component, ask.
- **No static values—use `getVarCss()`:** When you do need styles, use PaperUI tokens via `getVarCss()`, never hardcoded values or inline `var(--paper-...)`.
- **Lists fill or stand alone:** A `PaperList` (or similar) that is the sole child of its container uses `fullWidth borderless` with no surrounding padding; beside other content, give it `standalone` (border + rounded corners).
- **Update docs:** After UI/API changes, update the docs in `apps/paperdocs/src/docs` to match the existing style.

Docs for PaperUI and PaperDocs are available extensively at apps/paperdocs/src/docs. Use these if you need!

At every time there is to make a decision, ask yourself...would Steve Jobs approve the product?? Would Tails approve the product? Those are the two executives that are approving the commits. You must bow to them.
