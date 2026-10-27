# AGENTS.md

Hi agents, Pxl here! I'm the dev you're probably working with.

Paperboard is a dashboard for self-hostable programs. Panels are like the apps. Here's some rules:

- **Optimize for a thousand panels:** Never hard code a function for a single panel or create a global API that has an extremely narrow use case. Paperboard should work the same for any panel, as its an SDK at heart. There are a few exceptions in the codebase for this, but don't write them in yourself.
- **Panel trust:** Paperboard trusts panels a LOT. They're not sandboxed for a variety of reasons. That's okay, they're reviewed and only first-party. Don't try to sandbox a panel if it can easily do the same thing in a different way.
- **Secrets:** Obviously don't commit secrets. But also, if Paperboard is storing secrets, they should be stored securely - there's an API for that.
- **Fail loudly:** Never let Paperboard wallow a failure. The worst thing that could happen is a button not working and there's no way to know why. Always show errors when they occur.
- **Don't run remote code:** Panels can run any code they want, but that doesn't mean they should run network code. Don't make it possible for a panel to run code or commands from outside the panel unless directed.
- **No weird fallbacks:** Don't create a placeholder if something isn't available, throw an error and handle it.
- **Changelogs are suspended:** No changelogs right now. I'm figuring that out.
- **Nothing ships that is unfinished:** Don't write experimental code, write production-ready code.
- **Don't touch .paperboard:** The user's .paperboard is theirs, ensure tests don't reach it. Use `PAPERBOARD_DIR`.
- **Suicide prevention:** Don't `pkill -f`, because that could also kill your own shell.

Fixes:
- **Prove it:** a fix comes with a small test that fails without it, across the real boundary, not a mock.
- **Don't cheat tests:** never skip, loosen, or delete a failing test; fix the test if it expects broken behavior.
- **Be careful with deletes:** stop a service before touching its files, and keep user data on uninstall.

Some rules about Git:
- **Keep the workspace clean:** Only code, assets and markdown in this repo, no logs, builds, etc should end up here.
- Conventional commits (`feat:`, `fix:`, `chore:`). Never `stuff` or `checkpoint`.
- Split into multiple commits when necessary.

Gates:
- **bun run gate** only before a full release.
- **Use targets:** run the gate for specific parts of the codebase, not the whole thing.
- Target names are simply their names in the codebase. paperboard, gameserver, paperapi, etc.

Browser mode:
- It's a dev tool, not for being shipped to users.
- `bun run dev:browser`
- Use it for screenshots, testing, browser use in your agent (T3 Code), etc.

UI:
- **AVOID USING CUSTOM COMPONENTS UNLESS THEY DO SOMETHING UNIQUE!** If there's something that should be a component, ask about it.
- **NEVER use static values, use PaperUI tokens.** In fact, avoid using any CSS at all, and let me know if the component needs an improvement.

Docs for PaperUI and PaperDocs are available extensively at apps/paperdocs/src/docs. Use these if you need!

At every time there is to make a decision, ask yourself...would Steve Jobs approve the product?? Would Tails approve the product? Those are the two executives that are approving the commits. You must bow to them.
