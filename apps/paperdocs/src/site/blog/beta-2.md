---
title: Beta 2 is shipped!
date: 2026-10-19
author: pxlkt
image: /pictures/blog/beta-2/cover.jpg
summary: Home tab, widgets, backups, NeoForge/Forge, ACP...and way more.
---

Paperboard's newest update, Beta 2 is now available to download! For existing Paperboard users, you should be updated automatically.

This app won't ever be finished, and I'll always be working on feature updates, panel updates, and new panels to keep Paperboard awesome forever!

We're starting off this week with major improvements to every panel, and also Paperboard itself. Let's start with that:

## Home and Widgets

This is the highlight feature of this version, and the one I'm most excited to share! Starting now, when you launch Paperboard, you will now enter the **Home tab**, a collection of data points from all your panels.

- **View everything in one place** - Aggregate data from various panels and computers and see it all at once. Game Server chat, server count of your bot, players online, and more.
- **Get to your favorite places quicker** - Widgets are interactive, so you can write to an AI model, quickly execute a terminal command, or start your game server without even opening the panel.
- **View system data** - You can also see your memory, CPU, and how much of it Paperboard is taking up. _Hint: it's not too much. :)_
- **Your own canvas** - The home tab is personal to you. You can drag the widgets you want, wherever you want, inspired by the freedom of the Actions panel!

:::carousel
![Home with widgets](/pictures/blog/beta-2/hero.png "Your Home, filled with widgets from Paperboard and your panels.")
![The widget gallery](/pictures/blog/beta-2/home-widget-gallery.png "Pick widgets from the gallery and drop them on your Home.")
![Flag widgets on Home](/pictures/blog/beta-2/home-flag-widget.png "Fly a flag on your Home.")
:::

## Game Server

Game Server has massive, long awaited improvements. It's still easy to use, but now it's also extremely powerful.

- **Download and upload worlds** - You can now download and upload your Minecraft worlds without searching through the server files, regardless of what computer the server is running on!
- **Datapacks** - Search and add datapacks through Modrinth, and apply them in a click.
- **Modpacks** - Install modpacks on Fabric, NeoForge, and Forge.
- **NeoForge and Forge** - YES, you can now use and install these loaders just as easily as you can use the existing ones (Paper, Fabric, and Vanilla). Plus, editing their settings now has its own tab.
- **Files** - Edit configurations and view text files directly in the app, with a VSCode-style editor.
- **Rich MOTD Editing** - Edit the title of the server with colors and formatting, and view your edit directly on the Overview.

:::carousel
![Downloading a world](/pictures/blog/beta-2/gameserver-world-download.png "Download any world to your computer.")
![Datapacks in Game Server](/pictures/blog/beta-2/gameserver-datapacks.png "Add and remove datapacks.")
![Modpacks in Game Server](/pictures/blog/beta-2/gameserver-modpacks.png "Install modpacks on Fabric, NeoForge, and Forge servers.")
![The Loader tab](/pictures/blog/beta-2/gameserver-loader.png "Configure your server's loader.")
![Files in Game Server](/pictures/blog/beta-2/gameserver-files.png "Browse and edit your server's files.")
![Editing the MOTD](/pictures/blog/beta-2/gameserver-motd.png "Style your server's MOTD with colors and formatting.")
:::

## Backups

This is a very long awaited feature, and I've waited to implement it tastefully. It's worth the wait!

- **Back up your servers and flows** - Save your server! Keep snapshots of its history in various providers.
- **Google Drive and S3** - Connect your Google account to upload backups to Google Drive, or connect any S3 compatible API to upload directly to there.
- **Schedule backups** - Schedule a backup to run anywhere from every hour to once a week.

:::carousel
![Game Server backups](/pictures/blog/beta-2/gameserver-backups.png "Back up your server and restore it whenever you need.")
![Backup locations](/pictures/blog/beta-2/backup-locations.png "Choose where your backups are stored.")
:::

## AI

The AI panel has expanded in capability and can now integrate with the tools you use every day and pay for.

- **Claude Code, Codex, and ACP** - Link to any provider that supports the ACP standard, from OpenCode to Cursor to..._sigh_ Antigravity, if you must.
- **You're in control** - Agents can only run commands or edit files with your consent, unless you say otherwise.
- **Projects** - Each conversation can now have its own project for agents to work in, and they're stored with everything else. Switch between them to instantly give other agents context.

:::carousel
![Coding agents in the AI panel](/pictures/blog/beta-2/ai-coding-agents.png "Connect a coding agent to the AI panel.")
![Claude Code in the AI panel](/pictures/blog/beta-2/ai-claude-code.png "Work on a project with Claude Code.")
![A diff from Claude Code](/pictures/blog/beta-2/ai-claude-code-diff.png "See every change an agent makes.")
:::

## Bot Creator

Bot Creator now supports more interactions in Actions!

- **Select menus and modals** - Create full interactive flows using Discord's built in bot APIs.
- **Auto-defer** - If a command is taking a while to reply, it won't automatically fail!

Bot Creator requires the Actions panel for most abilities.

![Discord components in Actions](/pictures/blog/beta-2/actions-discord-components.png "Send buttons and menus from your Discord flows.")

## Actions

- **Export, import, and backup** - Don't lose your flows! You can now export the entire canvas to a file to share, or you can back up your actions to ensure you don't lose them or pick them up on another machine.

![Exporting and importing flows](/pictures/blog/beta-2/actions-export-import.png "Export flows and import them anywhere.")

## Terminal

- **Saved commands** - Save commands to use them quickly, or on widgets.

![Saved commands in Terminal](/pictures/blog/beta-2/terminal-saved-commands.png "Save the commands you run most.")

I'm excited to see what you all do with Paperboard! PaperUI and PaperAPI have also been updated to `0.2.0`, so if you're developing a panel, be sure to update. See you all soon for Beta 3! (or Beta 2.1 depending on how things go)

If you're new here, [**download Paperboard today!!!**](/downloads/)

\- Pxl

---

This update has also contained various security and bug fixes. To submit bug reports, open an issue on the [GitHub](https://github.com/MileniumHQ/Paperboard/issues), or the [Discord](https://discord.gg/DdnpP3pPfT).
