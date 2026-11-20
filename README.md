# Paperboard

This is the official repository for all things Paperboard. It's a monorepo, so it contains various different softwares including APIs, panels, websites, and of course...the app itself.

A quick brief on what Paperboard is - it's essentially a home for your server. The end goal is to let any task that needs self-hosting incredibly easy, without the need for any programming experience or terminal knowledge, whether that be a Discord bot or a Minecraft server Paperboard is designed to be a simple, consistent, and satisfying experience through-and-through.

Each tool in Paperboard is a panel, a self-contained project that can be instantly downloaded through the official registry and interacts with the rest of the app using APIs.

Almost all code here is written in TypeScript, CSS and SolidJS. I'll explain everything here briefly, but for more information on each part of this repo, I have placed another README in each project. Additionally, developing new panels has extensive docs at https://paperboard.dev/docs. That's the definitive place to go if you are looking to develop a new panel.

## Definitions

The repo has four kinds of parts:

- `apps/` are the programs Paperboard ships
- `services/` are online API services, typically on ariapis.com
- `packages/` are internal and external npm packages
- `panels/` are the first-party panels that make Paperboard what it is

`scripts/` at the root holds the gate (`scripts/gate`), the release tooling (`scripts/publish`), the supervisor build (`scripts/build`) and setup (`scripts/dev`)

- **Paperboard** (`apps/paperboard`) is the desktop app: the frontend that displays the interfaces of any panels. It runs the server daemon for its own computer inside it.
- **The server daemon** (`apps/daemon`, which the code likes to call PaperCrane but it really shouldn't) runs panels' persistent code and lets them integrate deeper into the user's device through a WebSocket. It is built into the app, and compiled on its own for other computers. Its workload supervisor (`apps/daemon/supervisor`) is the one part in this codebase written in Go.
- **PaperAPI** (`packages/paperapi`) abstracts the WebSocket calls into basic functions that panels can use.
- **PaperUI** (`packages/paperui`) provides a distinctive and unified design language for Paperboard UI. It's primarily components, with over 40 of them. It also includes tokens for spacing, fonts, and colors.
- **PaperDocs** (`apps/paperdocs`) is a Cloudflare Worker that serves the landing pages for Paperboard as well as the official docs and blog. It contains the entire documentation for PaperAPI and PaperUI.
- **Origami** (`services/origami`) is a Cloudflare Worker behind package downloads and updates. It contains a registry of packages like Java, as well as CDN services for panels and Paperboard.
- **Library** (`services/library`) is the panel store, served by Origami as a web page and inside the app.
- **Arilink** (`services/arilink`) is a worker that provides short-links on https://pbd.lc
- **Panel APIs** (`services/panelapis`) provides web APIs for panels that need them
- **npx** (`packages/npx`) is `npx @mileniumhq/paperboard`, which installs Paperboard or runs its server daemon.
- **testkit** (`packages/testkit`) is the shared test harness for CI and testing

And of course, the panels:

- **Game Server** (`dev.paperboard.gameserver`) is a great example of what a Paperboard panel should be. It runs servers for Minecraft, Terraria, Palworld, Rust, Team Fortress 2, Counter-Strike 2 and Garry's Mod, with rich features like player management, plugin search, and even a world map. And more. Usually when you say "and more" that means you ran out of things to say, but this panel keeps on giving.
- **Blocks** (`dev.paperboard.blocks`) builds automations out of blocks that every other panel provides. Post in Discord when a player joins your server, or restart it on a schedule, all by snapping blocks together on a canvas.
- **Bot Creator** (`dev.paperboard.botcreator`) has a basic interface for creating and viewing the state of a Discord bot, but where it really shines is in its blocks. Combined with the Blocks panel, fully interactive Discord bots can be created.
- **Agent** (`dev.paperboard.agents`) is an agent you text, with a web browser of its own. It thinks with the Codex, Claude or OpenCode you already have.
- **Terminal** (`dev.paperboard.terminal`) is a Terminal for when you want to use a Terminal in Paperboard. It used to be simple, but features like split tabs and saved commands have been added.

## Development

Paperboard is a Bun workspace. Install [Bun](https://bun.com/get) and [Go](https://go.dev/dl/), then clone the repository and run the setup command from the root:

```zsh
git clone https://github.com/MileniumHQ/Paperboard
cd Paperboard
bun run setup
```

`setup` installs every workspace's dependencies, fetches the Electron runtime binary (a one-time download of roughly 100 MB), builds the shared libraries, the workload supervisor and the panels, and links the panels into your Paperboard install. After that, each project has its own README with dev and build instructions. For the app, that's [apps/paperboard](apps/paperboard/README.md).

## Issues

If you find a bug, Issues are welcome and encouraged! Just submit a fairly comprehensive report based on your problem and we'll try our best to reproduce it.

**HOWEVER, if you want to avoid back and forth...**

This repo has a [trissue](https://github.com/pxlkt/trissue) config, which is a really convenient way to diagnose projects using agents. If you use Claude Code, Codex, or any harness, this can pull together an issue with minimal effort on your end.

To use it, ensure you have npm installed, and run:

```zsh
npx trissue MileniumHQ/Paperboard
```

You'll be prompted to explain your issue and select a harness. Once the issue is created, you can submit it to GitHub using the gh CLI or by copying it.

## Agents & Contributing

More information about contributing is available in [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome!

The overwhelming majority of this codebase is built with agents, therefore it's agent-first and has an (agent-generated) AGENTS.md containing a list of rules for agents (and contributors) to follow.

The code license varies by project, but most code here is under PolyForm Noncommercial...with exceptions! PaperUI, PaperAPI, and PaperDocs are all MIT licensed. Due to that variation, the project has no root license.

Thanks for taking a look. Let's build the future of Paperboard together!

---

© 2026 Milenium
