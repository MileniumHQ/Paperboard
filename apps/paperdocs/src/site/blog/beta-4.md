---
title: Beta 4 is shipped!
date: 2026-11-19
author: pxlkt
image: /pictures/blog/beta-4/cover.jpg
summary: Paperboard's biggest release ever. The brand new Blocks panel, an Agent that can work on your computer, and big upgrades to Terminal, Game Server and Paperboard itself.
---

I was going to say we got Paperboard Beta 4 before GTA VI, but I postponed the release. It's too late now.

Nevertheless, this is once again Paperboard's biggest release ever! Hundreds of bugs were squashed, another brand new panel has been released, and we've added many new features to the panels you already use. We've been working hard to improve the overall Paperboard experience so it's more intuitive than ever!

Without further ado, let's get into it. Starting with the brand new panel:

## Blocks

Replacing the Actions panel is the brand new **Blocks** panel! This panel replaces the Actions panel with an interface derived from Scratch, and it's a far easier way to connect your panels!

- **Drive the whole app programmatically:** Create servers, configure panels, send messages, and more without writing code.
- **Multiple projects:** Run various projects at once, organized and separated.
- **Back up your work and save it to a file:** Continue working from anywhere.

:::carousel
![Building a Blocks project](/pictures/blog/beta-4/blocks-library.png "Snap together blocks from every panel.")
![A finished Blocks project](/pictures/blog/beta-4/blocks-flow.png "Welcome every player who joins, and hear about a failed backup.")
:::

## Agent

The Agent panel has been given an update to make it even more useful and powerful. It already could sign into your accounts in a browser and connect to other services, but now those capabilities are more accessible than ever.

- **Access your computer, conditionally:** Agent can now run commands on your computer, asking before it touches folders or files.
- **Recieve files inline:** Recieve and preview audio, video, markdown, and more in the app.
- **Connect to apps and services:** Agent now has deeper support for MCP, and it can request to connect to an app just by being asked.

:::carousel
![Chatting with an agent](/pictures/blog/beta-4/agents-chat.png "Text your agent like you'd text a friend.")
![The agent's computer](/pictures/blog/beta-4/agents-computer.png "It browses the web in a computer of its own.")
![A permission request](/pictures/blog/beta-4/agents-access-request.png "It asks before it touches your computer.")
![The Access page](/pictures/blog/beta-4/agents-access-page.png "See and take back everything it's allowed to do.")
![A file in the chat](/pictures/blog/beta-4/agents-file-preview.png "It sends you files right in the chat.")
![Tool servers](/pictures/blog/beta-4/agents-tool-servers.png "Connect it to the other apps you use.")
![Routines](/pictures/blog/beta-4/agents-routines.png "Have it do things on a schedule.")
:::

## Terminal

The Terminal panel gets its first major improvement since launch!

- **Split tabs:** Split a tab into two shells, side by side.
- **Vertical tabs:** Save vertical space with the option to move the tabs to the left.
- **Search:** Looking for something? You can now search for things in the terminal output.

![Split shells](/pictures/blog/beta-4/terminal-tabs-split.png "Two shells side by side in one tab.")

## Paperboard

Major quality of life updates have shipped to Paperboard as well.

- **In-app updater:** Tired of waiting for updates to finish? Now, all updates to packages, panels, and apps happen in a new update interface available on the top menu.
- **Open in browser:** Using `paperboard --web` from the command line or right click Paperboard's icon in the app tray, you can open the Paperboard interface in your web browser instead of its own window.
- **Easy install:** Install Paperboard with `npx @mileniumhq/paperboard install`, or run just the Paperboard server with `npx @mileniumhq/paperboard serve`. Additionally, .deb and .rpm packages have been added for Linux users.
- **See what went wrong:** When something in a panel fails, its row in the sidebar tells you.
- **Never lose your work:** Paperboard asks before closing a panel or quitting while you have unsaved work.

:::carousel
![The updater](/pictures/blog/beta-4/updater-popover.png "Updates happen from the top bar while you keep working.")
![The Panel Library](/pictures/blog/beta-4/library-home.png "Find new panels in the Panel Library.")
![A panel's page](/pictures/blog/beta-4/library-panel-page.png "Every panel has its own page.")
![Animations and blur settings](/pictures/blog/beta-4/settings-animations-blur.png "Turn animations and blur off separately.")
:::

## Other Panels

- **Game Server:** Garry's Mod, Rust, and Counter-Strike 2 have been added. Rust gets a map of your world. Plus, every game's overview shows four live readouts.
- **Bot Creator:** New Blocks are now available in the Blocks panel, to use for building.

:::carousel
![Choosing a game](/pictures/blog/beta-4/gameserver-choose-game.png "Three new games to choose from.")
![A Rust map](/pictures/blog/beta-4/gameserver-rust-map.png "See your Rust world from above.")
![A Rust server's overview](/pictures/blog/beta-4/gameserver-rust-overview.png "Four live readouts on every server's overview.")
![Counter-Strike 2 maps](/pictures/blog/beta-4/gameserver-cs2-maps.png "Pick Counter-Strike 2 maps by picture.")
![Download size](/pictures/blog/beta-4/gameserver-download-size.png "See how big a download is before it starts.")
:::

In addition, many bug fixes, UI improvements, and performance enhancements have been implemented throughout the entire app and all panels. There's so much more to this update than I had time to mention here!

For developers, there are new APIs, PaperUI components, and tools available to use now in the [PaperDocs](/docs/)!

---

This update brings Paperboard even further forward towards its goal of becoming the most intuitive universal tool for self-hosting. I'm so excited for the road ahead!

As we continue improving our agentic workflows and processes for developing Paperboard, stability, release cadence, and performance will continue getting better!

I've also said "we" a lot during this post, and that's because I'd like to thank [Rerro](https://github.com/rerrorate777) for being Paperboard's first major contributor! Their work has gone a long way in fixing and finding bugs, improving Paperboard's overall experience.

I'm thrilled to see what happens next with these powerful new tools. We haven't scratched the surface of what's possible with this app, and this is its biggest step yet.

\- Pxl

---

This update has also contained various security and bug fixes. To submit bug reports, open an issue on the [GitHub](https://github.com/MileniumHQ/Paperboard/issues), or the [Discord](https://discord.gg/DdnpP3pPfT).
