---
title: "Postmortem: ring-based navigation"
date: 2026-09-19
image: /pictures/blog/rouge.jpg
summary: We replaced every sidebar with golden rings. Users collected 42 of them and then fell off the map.
---

For one week, every navigation element in Paperboard was a golden ring. Clicking a ring moved you to the next screen and played a bright chime. Collecting 100 rings was supposed to open the settings panel. Nobody collected 100 rings, because after 42 rings the layout ran out of screens and users fell off the map.

![The Panel Library, before the rings](/screens/panel-library.png "The Panel Library, back when it had a sidebar.")

## What went well

The chime was excellent. It remains in the app, attached to nothing. Ring density was uniform across panels, which the design team described as "finally consistent" before they also fell off the map.

The rings visited every panel on their way off the map:

:::carousel
![Game Server panel](/screens/gameserver.png "Game Server: 12 rings, all of them in the lava.")
![Bot Creator panel](/screens/botcreator.png "Bot Creator: 9 rings and one chime command.")
![Actions panel](/screens/actions.png "Actions: a flow that collected rings by itself.")
![Terminal panel](/screens/terminal.png "Terminal: no rings. It would not say why.")
:::

## What went wrong

We did not budget for rings. The map had room for 42. The settings panel needed 100. The remaining 58 rings were never placed, so the settings panel floated in the void, chiming softly. We have restored the sidebar and sent the rings to live with the loading screen.
