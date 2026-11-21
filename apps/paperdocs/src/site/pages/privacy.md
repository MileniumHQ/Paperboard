_Last updated November 20, 2026_

Paperboard and Origami are run by Milenium. This page says what leaves your computers when you use them, and where it goes.

## The short version

Paperboard runs on your own computers. Your panels, their files and settings, and the keys you save stay on those computers. We do not run accounts, analytics, tracking, or ads, and we do not sell or share data.

## What reaches our servers

Paperboard downloads panels from our panel library (origami.ariapis.com), and app updates from i.paperboard.dev and GitHub. The install command (`curl -fsSL https://i.paperboard.dev | sh`, or `npx @mileniumhq/paperboard install`) downloads Paperboard from the same two places. Like any website, these servers see your IP address and which file you asked for. Our host, Cloudflare, keeps request logs for a few days so we can keep the service running and fix problems. We do not combine them with anything else.

Some panels ask our panel APIs (panels.ariapis.com) for things a panel can't do on its own computer. The Game Server panel's Workshop tab searches and looks up Steam Workshop mods through it, so it sees your IP address, your search terms and the mod ids you look up. It passes them to Steam, keeps the answers in Cloudflare's cache for a minute (searches) or five minutes (mod details), and stores no record of who asked. It uses your IP address only to limit how many requests one computer can make.

This website stores your light or dark theme choice in your browser and nothing else. It sets no cookies.

## Backups

Backups go only where you choose: the computer itself, an S3 bucket, or Google Drive. They travel straight from your computer to that place and never pass through our servers. The keys and sign-ins for a backup location are kept in that computer's encrypted key store.

## Google Drive

When you connect Google Drive, Paperboard asks only for access to the files it creates. It keeps backups in a "Paperboard Backups" folder and cannot see your other files. The sign-in it receives stays on the computer that makes the backups and is never sent to us. To disconnect, remove the location in Paperboard, or remove Paperboard at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Paperboard's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Panels

Some panels contact other services, for example to download a game server or connect a Discord bot. Each panel's library page lists the services it contacts under "Services used", and what it uses them for. Those services' own privacy policies apply to what they receive.

For example, the Game Server panel shows a Steam player's profile picture in its Players list. It asks Steam Community (steamcommunity.com) for the picture of each player's public Steam id, and downloads it from Steam's avatar servers (avatars.fastly.steamstatic.com, avatars.akamai.steamstatic.com and avatars.cloudflare.steamstatic.com). Steam sees your IP address and the Steam ids of the players on your server. It keeps what it finds in memory for a day, and the panel never sends them anywhere else.

## Contact

For questions, or to ask what data we have about you, write to [contact@mileniumhq.com](mailto:contact@mileniumhq.com) or use the [contact page](/contact/).

If this policy changes, we will update this page and the date at the top.
