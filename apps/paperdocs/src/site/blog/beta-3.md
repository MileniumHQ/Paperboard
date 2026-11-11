---
title: Beta 3 is shipped!
date: 2026-11-07
author: pxlkt
image: /pictures/blog/beta-3/cover.jpg
summary: Paperboard's biggest update yet. A brand new panel, more games, and so much more.
---

Happy weekend! Just because it's not a Monday doesn't mean that I'm going to stop shipping great Paperboard updates! Available now is Beta 3, our biggest update yet.

In this update, are a whole new panel, big updates to Game Server, and more! Starting off with the biggest part of this update, Paperboard Agent!

## Agent

The new Agent panel is a personal assistant with its own computer, so it can execute tasks and summarize knowledge for you on your own behalf!

- **A single chat:** Text it like it's an assistant, not a chatbot. It responds conversationally!
- **A computer of its own:** Agent has a browser and filesystem separate from yours, so it can't access your computer. You can still share it files when you want to!
- **Apps:** Create custom apps just for yourself with just a prompt.
- **Pick your own brain:** Agent doesn't have a brain of its own, you can connect your existing Claude Code or Codex subscriptions, or use whatever you need through OpenCode!
- **Memories, routines:** Your Agent remembers information you give it. It won't forget your name, or a cookie recipe you asked it to remember.
- **Add your own tools:** Agent can use MCP servers on your computer, so integrate with Figma, Notion, Slack, GitHub, Google apps, and infinitely more.
- **Connect with Paperboard panels:** Agents fully supports your existing Paperboard panels, so you can ask your agent to start the Minecraft server or send a Discord message to your friend.

:::carousel
![Chatting with an agent](/pictures/blog/beta-3/agents-chat.png "Text your agent like you'd text a friend.")
![The agent's computer](/pictures/blog/beta-3/agents-computer.png "Watch the agent work in its own browser, or take over.")
![An app the agent made](/pictures/blog/beta-3/agents-app.png "Ask for an app, and open it right beside the chat.")
![Meeting your agent](/pictures/blog/beta-3/agents-onboarding.png "Pick a brain and a model when you meet your agent.")
![Memories](/pictures/blog/beta-3/agents-memories.png "See everything it remembers, and make it forget anything.")
![Routines](/pictures/blog/beta-3/agents-routines.png "Have it do things on a schedule.")
:::

This replaces the legacy AI panel, which will still recieve new updates for model releases, but is no longer downloadable from the Panel Library.

## Game Server

Game Server now lives up to its name, it's not just Minecraft anymore! It now supports Terraria, Palworld, Team Fortress 2, and supports multiple servers running at the same time!

### New games

- **Terraria:** Full mod support via tModLoader.
- **Palworld:** The same chat and player features you know and love for Minecraft
- **Team Fortress 2:** - SourceMod support, pick maps and set the map rotation, and play maps from Steam Workshop.
- **Choose a game first:** Pick any supported game when setting up a server.
- **Run multiple servers:** If your hardware supports it, you can run multiple servers at the same time.

:::carousel
![Choosing a game](/pictures/blog/beta-3/gameserver-choose-game.png "Start by choosing a game.")
![A Terraria world](/pictures/blog/beta-3/gameserver-terraria.png "See your Terraria world's evil, hardmode and bosses.")
![Palworld](/pictures/blog/beta-3/gameserver-palworld.png "Run a Palworld server and keep an eye on its health.")
![Team Fortress 2 maps](/pictures/blog/beta-3/gameserver-tf2-maps.png "Pick Team Fortress 2 maps by picture, Workshop maps included.")
![Servers home](/pictures/blog/beta-3/gameserver-servers.png "Manage every server from one place.")
:::

Terraria, Palworld and TF2 are not supported on macOS as of this post's release.

In addition, Minecraft servers get a big buff as well.

### Minecraft

- **Crossplay** Set up Minecraft: Bedrock Edition support in just a click, letting mobile, console, and desktop players play side-by-side.
- **Performance** Set render distance and simulation distance, and configure memory more easily. Additionally, this update ships performance improvements for worse hardware.
- **Server icon:** You had the MotD, now change the server icon as viewed in game just as quickly.
- **Resource packs:** Add resource packs from Modrinth or your own URL.
- **Upload directly:** Upload mods and plugins straight from your computer.
- **And more...** OP and whitelist players while the server is offline, automatically restart after a crash, and many more small improvements and bug fixes!

:::carousel
![Crossplay](/pictures/blog/beta-3/gameserver-crossplay.png "Let Bedrock players join with Geyser and Floodgate.")
![Server sliders](/pictures/blog/beta-3/gameserver-sliders.png "Set memory and view distance with sliders.")
:::

## All Panels

Other panels got improvements too! You can now run multiple Discord bots at once and have multiple projects in Actions. Additionally, Bot Creator is more capable with polls, search, and permissions.

:::carousel
![Several bots in Bot Creator](/pictures/blog/beta-3/botcreator-bots.png "Run several bots, each with its own project.")
![Projects in Actions](/pictures/blog/beta-3/actions-projects.png "Keep your flows in projects.")
:::

## Paperboard

- **Choose where it opens:** Open Paperboard on Home or straight to a computer.
- **Workloads survive a crash:** If Paperboard crashes, your servers and bots keep running, and Paperboard picks them back up when it reopens.
- **UI fixes:** Paperboard's interface has been improved for better clarity and usability.
- **Bug fixes and improvements:** All around, many bugs have been squashed, big and small.

## For developers

Paperboard's MIT-licensed packages have been updated to `0.3.0`. Here's some of what's new:

- **Port API:** Panels claim ports through Paperboard, so they never fight over one.
- **Loopback pages:** A panel can show a page its service serves on loopback.
- **create-panel:** Scaffold panels the way first-party ones are built.
- **npx @mileniumhq/paperboard:** Run the server daemon with one command
- **paperapi CLI:** Develop your panels using the paperapi CLI, with the new monitor, doctor, and restart commands.
- **Brand new docs:** Docs have been rewritten, so you can make panels just like first-party.
- **Work with agents:** The new docs site is also compatible with MCP, so your agents can finally build with Paperboard.

Check them out and build the next panel at [https://paperboard.dev/docs](https://paperboard.dev/docs).

---

This is a significant update, and only one of even more significant updates to come. There is so much more planned for Beta 4 and beyond, I'm so excited to release it!

The update should automatically install for most, but if it doesn't you can [**download Paperboard today!!!**](/downloads/)

Enjoy!

\- Pxl

---

This update has also contained various security and bug fixes. To submit bug reports, open an issue on the [GitHub](https://github.com/MileniumHQ/Paperboard/issues), or the [Discord](https://discord.gg/DdnpP3pPfT).
