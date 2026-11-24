_Last updated November 23, 2026_

Paperboard and Origami are run by Milenium. This page says what leaves your computers when you use them, and where it goes.

## The short version

Paperboard runs on your own computers. Your panels, their files and settings, and the keys you save stay on those computers. We do not run accounts, analytics, tracking, or ads, and we do not sell or share data.

## What reaches our servers

Paperboard downloads panels from our panel library (origami.ariapis.com), and app updates from i.paperboard.dev and GitHub. The install command (`curl -fsSL https://i.paperboard.dev | sh`, or `npx @mileniumhq/paperboard install`) downloads Paperboard from the same two places. Like any website, these servers see your IP address and which file you asked for. Our host, Cloudflare, keeps request logs for a few days so we can keep the service running and fix problems. We do not combine them with anything else.

Some panels also use our panel APIs (panels.ariapis.com) for things they can't do on your computer alone. Like the servers above, they see your IP address and what the panel asked for. They keep no record of who asked, and use your IP address only to limit how many requests one computer can make.

This website stores your light or dark theme choice in your browser and nothing else. It sets no cookies.

## Backups

Backups go only where you choose: the computer itself, an S3 bucket, or Google Drive. They travel straight from your computer to that place and never pass through our servers. The keys and sign-ins for a backup location are kept in that computer's encrypted key store.

## Google Drive

When you connect Google Drive, Paperboard asks only for access to the files it creates. It keeps backups in a "Paperboard Backups" folder and cannot see your other files. The sign-in it receives stays on the computer that makes the backups and is never sent to us. To disconnect, remove the location in Paperboard, or remove Paperboard at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Paperboard's use and transfer of information received from Google APIs to any other app will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Reporting an issue

When you report an issue from App Settings, Paperboard sends what you typed to our issues service (issues.ariapis.com), with Paperboard's version, your operating system and its version, your processor type, and whether you used the app or a browser. Unless you turn it off, it also sends the panels on the computer you're looking at and their versions, and recent lines from Paperboard's log on your computer, with folder paths, user and computer names, network addresses, emails and keys replaced before they leave. The report shows you exactly what will be sent. Only the maintainer can read it. Like our other servers, the service sees your IP address; it uses it only to limit how many issues one computer can send, and does not keep it. Issues are stored with Cloudflare until we delete them, which we do once they are dealt with. Write to us to have one deleted sooner.

## Panels

Some panels contact other services, for example to download a game server or connect a Discord bot. Each panel's library page lists the services it contacts under "Services used", and what it uses them for. Those services' own privacy policies apply to what they receive.

## Contact

For questions, or to ask what data we have about you, write to [contact@mileniumhq.com](mailto:contact@mileniumhq.com) or use the [contact page](/contact/).

If this policy changes, we will update this page and the date at the top.
