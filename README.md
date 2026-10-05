# Paperboard

This is the official repository for all things Paperboard. It's a monorepo, so it contains various different softwares including APIs, panels, websites, and of course...the app itself.

A quick brief on what Paperboard is - it's essentially a home for your server. The end goal is to let any task that needs self-hosting incredibly easy, without the need for any programming experience or terminal knowledge, whether that be a Discord bot or a Minecraft server Paperboard is designed to be a simple, consistent, and satisfying experience through-and-through.

Each tool in Paperboard is a panel, a self-contained project that can be instantly downloaded through the official registry and interacts with the rest of the app using APIs.

Almost all code here is written in TypeScript, CSS and SolidJS. I'll explain everything here briefly, but for more information on each part of this repo, I have placed another README in each project. Additionally, developing new panels has extensive docs at https://paperboard.dev/docs. That's the definitive place to go if you are looking to develop a new panel.

## Definitions

- **Paperboard** (`apps/paperboard`) is comprised of two parts internally: the server component/backend (which the code likes to call PaperCrane), and the frontend. The frontend displays the interfaces of any panels, while the backend runs their persistent code and lets them integrate deeper into the user's device through a WebSocket.
- **PaperAPI** (`packages/paperapi`) abstracts the WebSocket calls into basic functions that panels can use.
- **PaperUI** (`packages/paperui`) provides a distinctive and unified design language for Paperboard UI. It's primarily components, with over 40 of them. It also includes tokens for spacing, fonts, and colors.
- **Origami** (`apps/origami`) is a Cloudflare Worker with a few jobs, as the backend server for Paperboard downloads. It currently includes the CDN for distributing Paperboard packaged binaries, the CDN and registry for distributing panels, and the URL index for external packages like Java.
- **PaperDocs** (`apps/paperdocs`) is a Cloudflare Worker that serves the landing pages for Paperboard as well as the official docs and blog (soon). It contains the entire documentation for PaperAPI and PaperUI.
- **PaperConvert** (`apps/paperconvert`) is a side project that is primarily a promo for the app, but isn't receiving active updates as it is not currently in focus. Similar to other online converters, it's a basic file converter, except unlike online converters, it uses Web APIs to convert files without them entering the internet, which is far more private and efficient.

And of course, the panels:

- **Game Server** (`dev.paperboard.gameserver`) is a great example of what a Paperboard panel should be. It's currently a Minecraft server manager (with support for other games planned) with rich features like player management, plugin search, and even a world map. And more. Usually when you say "and more" that means you ran out of things to say, but this panel keeps on giving.
- **Actions** (`dev.paperboard.actions`) is a powerful visual interface to create entire workflows using Paperboard's Actions API. Taking design inspiration from Apple Shortcuts and Scratch, this panel lets you automate all your other panels to work with each other as easily as dragging a block onto a canvas.
- **Bot Creator** (`dev.paperboard.botcreator`) has a basic interface for creating and viewing the state of a Discord bot, but where it really shines is in its Actions. When combined with the Actions panel, fully interactive Discord bots can be created.
- **AI** (`dev.paperboard.ai`) is incomplete, but will provide an interface for using AI language models locally with the capability to trigger actions (with the user's consent) through tool calls.
- **Terminal** (`dev.paperboard.terminal`) is a basic Terminal for when you want to use a Terminal in Paperboard. There isn't much to this one.

## Development

Paperboard is a Bun workspace. Install [Bun](https://bun.com/get), then clone the repository and run the setup command from the root:

```zsh
git clone https://github.com/MileniumHQ/Paperboard
cd Paperboard
bun run setup
```

`setup` installs every workspace's dependencies, fetches the Electron runtime binary (a one-time download of roughly 100 MB), builds the shared libraries and panels, and links the panels into your Paperboard install. After that, each project has its own README with dev and build instructions. For the app, that's [apps/paperboard](apps/paperboard/README.md).

## Agents & Contributing

More information about contributing is available in [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome!

The overwhelming majority of this codebase is built with agents, therefore it's agent-first and has an (agent-generated) AGENTS.md containing a list of rules for agents (and contributors) to follow.

The code license varies by project, but most code here is under PolyForm Noncommercial...with exceptions! PaperUI, PaperAPI, PaperConvert, and PaperDocs are all MIT licensed.

Thanks for taking a look. Let's build the future of Paperboard together!

---

© 2026 Milenium
