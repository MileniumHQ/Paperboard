# AGENTS.md

Hi agents, Pxl here! I'm the dev you're probably working with.

Paperboard is a dashboard for self-hostable programs. Panels are like the apps. Here's some rules:

- **Optimize for a thousand panels:** Never hard code a function for a single panel or create a global API that has an extremely narrow use case. Paperboard should work the same for any panel, as it's an SDK at heart. There are a few exceptions in the codebase for this, but don't write them in yourself.
- **Panel trust:** Paperboard trusts panels a LOT. They're not sandboxed for a variety of reasons. That's okay, they're reviewed and only first-party. Don't try to sandbox a panel if it can easily do the same thing in a different way.
- **Secrets:** Obviously don't commit secrets. But also, if Paperboard is storing secrets, they should be stored securely - there's an API for that.
- **App keys live in `.env.local`:** Third-party app keys (like the Google Drive OAuth client) go in gitignored `apps/paperboard/.env.local`. Release builds need that file. The privacy page (`apps/paperdocs/src/site/pages/privacy.md`) must list every backup provider and every outbound service.
- **Fail loudly:** Never let Paperboard swallow a failure. The worst thing that could happen is a button not working and there's no way to know why. Always show errors when they occur.
- **Don't run remote code:** Panels can run any code they want, but that doesn't mean they should run network code. Don't make it possible for a panel to run code or commands from outside the panel unless directed.
- **No weird fallbacks:** Don't create a placeholder if something isn't available, throw an error and handle it.
- **Changelogs are suspended:** No changelogs right now. I'm figuring that out.
- **Nothing ships that is unfinished:** Don't write experimental code, write production-ready code.
- **Don't touch .paperboard:** The user's .paperboard is theirs, ensure tests don't reach it. Use `PAPERBOARD_DIR`.
- **Suicide prevention:** Don't `pkill -f`, because that could also kill your own shell.
- **Leave the real app alone:** Never kill the installed Paperboard app or its workloads (game servers, supervisors). People play on those servers. If the real app crashed, check whether a session killed it before debugging Paperboard.
- **Launching from an agent shell:** Your shell may set `ELECTRON_RUN_AS_NODE=1`, which makes Electron crash. Launch with `env -u ELECTRON_RUN_AS_NODE`, a throwaway `PAPERBOARD_DIR` and `--user-data-dir`.
- **Always test.** Unless you're certain it'll work fine, always do a manual check to ensure the feature works and looks great.
- When making Actions, placeholders are the type (etc "Text" or "Channel ID") and not a description (etc "Example Text" "1234567890")

- **Be careful with deletes:** stop a service before touching its files, and keep user data on uninstall.

Tests:

- **Tests are CI:** deterministic, no sleeps or timing races, no network, nothing from the dev's machine. Temp dirs only, via `PAPERBOARD_DIR`.
- **Real boundaries:** real filesystem, processes, Electron and browser over mocks.
- **Platform tests:** CI runs everything once on Linux x64. Only tests whose outcome depends on the OS or CPU go in a `tests/platform` (or `test/platform`) directory, which also runs on Linux arm64, macOS x64/arm64 and Windows x64. Those stay portable: no POSIX-only shells, paths or signals outside a per-platform branch.
- **Fewer, stronger tests:** only data loss, security, install/update/release, core contracts and shipped bugs in core flows. `tests-inventory.md` lists what the suite covers; add to it when you add a test.
- **Prove it:** a fix comes with a small test that fails without it.
- **Don't cheat tests:** never skip, loosen, `.todo` or delete a failing test. A test that can't run fails with the reason. If a test expects broken behavior, fix the test.

Some rules about Git:

- **Keep the workspace clean:** Only code, assets and markdown in this repo, no logs, builds, etc should end up here.
- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff` or `checkpoint`.
- Split into multiple commits when necessary.
- **Shared checkout:** Other sessions may switch this checkout's branch mid-task. Run `git branch --show-current` before every commit or merge, commit with `git commit -- <paths>` (never `git add -A` or a bare `git commit`), and never touch another session's uncommitted files.
- **Branches:** `company` is only for accounts work (sign-in, Paperboard Cloud, web hosting). Everything else goes to `main`, even if you're sitting on `company`. Merge `main` into `company`, never the other way, and never push `company`.

Gates:

- **bun run gate** only before a full release.
- **Use targets:** run the gate for specific parts of the codebase, not the whole thing.
- Target names are simply their names in the codebase. paperboard, gameserver, paperapi, etc.

Browser mode:

- It's a dev tool, not for being shipped to users.
- `bun run dev:browser`
- Use it for screenshots, testing, browser use in your agent (T3 Code), etc.
- USE THE T3 PREVIEW IF AVAILABLE. If it's not available, use a headless browser (preferrably Helium). **How the UI looks must be held to the highest standard.**

UI:

- **AVOID USING CUSTOM COMPONENTS UNLESS THEY DO SOMETHING UNIQUE!** If there's something that should be a component, ask about it.
- **NEVER use static values, use PaperUI tokens.** In fact, avoid using any CSS at all, and let me know if the component needs an improvement.
- **Avoid inline styles and custom components:** In general, you shouldn't even have to think about PaperUI tokens, the goal is for the app to be buildable with just PaperUI elements and no style tags. This isn't always possible, especially in more custom components like the text input in the Agents panel or the entire Actions panel and many more examples. However, if you're just building buttons that do things, there's a high chance PaperUI's existing components are all you'll need.
- **Use getVarCss:** If you do use design tokens, do not use inline `var(--paper-example-property)`. Instead, use PaperUI's `getVarCss()` function.
- **Update docs:** After the change, update the docs in the below docs folder, adhering to the style of the rest of the docs.

Docs for PaperUI and PaperDocs are available extensively at apps/paperdocs/src/docs. Use these if you need!

At every time there is to make a decision, ask yourself...would Steve Jobs approve the product?? Would Tails approve the product? Those are the two executives that are approving the commits. You must bow to them.
