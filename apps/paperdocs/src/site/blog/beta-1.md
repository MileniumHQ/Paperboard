---
title: Beta 1 is now available!
date: 2026-10-05
author: pxlkt
image: /pictures/blog/beta-1/hero.png
summary: Paperboard's first beta is out for YOU to download (🎉🎉🎉), here's what it can do!
---

**Paperboard Beta 1 is now available!** This is Paperboard's official public release, and there's a lot to share.

So please, grab some popcorn and let me guide you through what Paperboard is, and you'll soon understand why it's one of the coolest apps you'll ever see. :)

## It's not just one app.

When you open Paperboard, the first place you'll navigate to is the **Panel Library**.

![The Panel Library](/pictures/blog/beta-1/panel-library.png "The Panel Library, where every panel lives.")

This is like the App Store, except everything is free, high-quality, and first-party. And here you'll notice: **Paperboard isn't just one app that does one thing**, it's an ecosystem of custom-crafted tools that work together seamlessly to give you an intuitive, hassle-free experience for whatever you need to do.

Let's dig in. The first thing I'll show you is **Game Server**, a Minecraft server panel.

## Game Server

This is the easiest time you will have setting up a local Minecraft server. The panel guides you through the setup process:

1. Select a server software (Vanilla, Paper, Fabric)
2. Select a Minecraft version

That's it! Here's what you would have done without this panel:

- Download and configure Java (ensure you got the right version)
- Search all over the web for the server software you need
- Configure JVM arguments (you have to learn the terminal too, and...just so you know, that's not something you ever have to do in Paperboard 👀)
- Manually run the JAR file you downloaded earlier (jar file? like Tupperware??)
- Find and modify a plaintext file to accept the EULA

Okay, that might be a _bit_ of an exaggeration. But here's what all that looks like in Paperboard:

![Loaders on the Game Server panel](/pictures/blog/beta-1/gameserver-loaders.png "Paperboard does all the tedious work for you.")

I rest my case. And the magic doesn't end there, once you're set up, starting the server is a single click. Here's some other things it can do (these can be a headache traditionally):

:::carousel
![Game Server players list](/screens/gameserver-players.png "Manage your players, ops, and whitelist.")
![Game Server plugins](/screens/gameserver-plugins.png "Browse and install plugins and mods.")
![Game Server actions](/screens/gameserver-actions.png "Hook your server into flows with Actions.")
:::

## AI

This is where Paperboard's AI features are centered -- just another panel, and never a default or a requirement. Paperboard is equipped to handle the AI era we're in _locally_, just like the rest of the app. Instead of sending any requests to the cloud where you don't control them, download and run models entirely on your own computer that you paid for.

![The AI panel](/screens/ai.png "Chat with models running on your own computer.")

It's like your own free ChatGPT, except more reliable and verifiably private to you.

Experimentally, AIs can also search the web, and _with your consent_ they can also execute other panels' actions and run commands on your computer.

_AI is a bit heavy, so you will need a fairly good GPU to run more capable models._

## Actions

Remember how earlier I said Paperboard panels work together? This panel is the definition of that.

:::carousel
![A Discord flow in Actions](/screens/actions-discord-flow.png "Build Discord bot behavior from blocks.")
![A Game Server flow in Actions](/screens/actions-game-flow.png "React to what happens on your Minecraft server.")
![An AI flow in Actions](/screens/actions-ai-flow.png "Put local AI to work inside a flow.")
![Logic blocks in Actions](/screens/actions-logic.png "Branch, loop, and compare without code.")
![Game Server map](/screens/gameserver-map.png "View a map of your server. What other panel has a map? None of them.")
:::

Inspired by the works of Scratch, Blockly, and Apple Shortcuts comes the **Actions panel**. With this panel, you can create powerful automations and flows that interact with the panels you have installed -- without writing a single line of code.

Plus, this integrates with the Bot Creator panel also included in Paperboard. YES, with Paperboard you can build entire Discord bots just by dragging blocks onto a canvas. The use cases are unlimited and up to your own imagination, but here's a few that scratch the surface:

- **Minecraft Server Bot:** Build a Discord bot that proxies the chat between your Minecraft server and Discord server. Add other features like a command to let players know who's online.
- **Intelligent Sort:** Build a workflow that uses AI to automatically sort and organize files into a folder on your computer.
- **Auto-Mod:** Keep bad actors out of your Discord/Game server by creating automations to programmatically delete bad messages and warn rule-breakers.

You have to try this one out for yourself, there's a lot to discover.

---

That's what I have time to show you for panels, but there's so much more in this app, just waiting for you to discover it.

## Devs

If you can code, I have even more just for you!

Paperboard has an open-source SDK, so you can get started building your own custom panels in minutes!

![The PaperAPI docs](/pictures/blog/beta-1/paperapi-docs.png "Scaffold a new panel with one command.")

Start coding with the PaperAPI docs at https://paperboard.dev/paperapi!

Additionally, Paperboard itself is **source-available** and PRs are absolutely welcome. You can improve Paperboard for everyone with your contribution; the repo is at https://github.com/MileniumHQ/Paperboard!

## Remote

You can run Paperboard on your main computer and it will work great, but you can install Paperboard's **remote server daemon** on another computer, and access the entire interface from the Electron app anywhere!

You can download and install the Paperboard server daemon from the [downloads page](https://paperboard.dev/downloads). In the Paperboard interface, just click the plus-shaped button on the leftmost sidebar to get started with setup!

Paperboard runs anywhere -- on an old laptop, a VPS, a Raspberry Pi, or anywhere else that runs Paperboard's supported platforms.

---

Thank you so much for reading till the end. This is just the start of Paperboard's journey, and there's so much more coming soon that I have yet to share. The road ahead looks amazing, and we're approaching it rapidly. :3

I hope I've convinced you to download Paperboard and take a look for yourself. There are download buttons all over this site, but in case you missed them:

[The downloads page!](https://paperboard.dev/downloads)

\- Pxl

Follow [@PaperboardHQ](https://x.com/PaperboardHQ) on X for updates.
