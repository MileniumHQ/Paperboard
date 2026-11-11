# @mileniumhq/paperboard

Install and open Paperboard, or run its server daemon, without downloading anything by hand:

```sh
npx @mileniumhq/paperboard            # open Paperboard (asks to install it first if it isn't installed)
npx @mileniumhq/paperboard web        # open Paperboard in your browser
npx @mileniumhq/paperboard install    # install Paperboard, or update it to the latest release
npx @mileniumhq/paperboard serve      # run the server daemon in this terminal, without the app
```

`npm install -g @mileniumhq/paperboard` installs Paperboard as well, and puts this command on your PATH as `paperboard`.

## Installing Paperboard

`install` runs the same installer as `curl -fsSL https://i.paperboard.dev | sh` (Linux, macOS) and `irm https://i.paperboard.dev | iex` (Windows). Both ship in this package, in `install/`, and Origami serves these same files. The installer downloads the latest release's file for your computer, checks it against the release's `SHA256SUMS`, and installs it:

| Computer | Installs | Where |
| --- | --- | --- |
| Windows | Paperboard's installer, for your account | `%LOCALAPPDATA%\Programs\paperboard` |
| macOS | Paperboard.app | `/Applications` |
| Debian, Ubuntu | the deb, with apt (through sudo) | `/opt/Paperboard` |
| Fedora, openSUSE | the rpm, with dnf or zypper (through sudo) | `/opt/Paperboard` |
| any other Linux | the AppImage, a menu entry and `~/.local/bin/paperboard` | `~/.local/share/paperboard` |

`PAPERBOARD_INSTALL_AS=deb|rpm|appimage` picks the Linux format yourself.

Paperboard always runs from an installed copy, so it updates itself like any install. Plain `npx @mileniumhq/paperboard` and `web` open the installed app. Only when there's none do they ask before installing it; without a terminal to ask in, they stop and say to run `install`. Installing the package with npm is the consent, so `npm install -g` doesn't ask. npx installing the package to run it doesn't install Paperboard on its own.

## The server daemon

Every command but `install`, `web` and `help` goes to the daemon (`papercrane`) unchanged:

```sh
npx @mileniumhq/paperboard serve --port 45465
npx @mileniumhq/paperboard install-service    # run it in the background, starting with the computer
npx @mileniumhq/paperboard pair               # show a pairing code on the running daemon
npx @mileniumhq/paperboard status
```

The daemon comes from the same signed release Paperboard's own updater reads:

1. It reads the release index at `https://origami.ariapis.com/paperdl/crane/index.json`.
2. It checks the entry's signature against the Paperboard release key, using the daemon's own verifier. Nothing is downloaded from an entry the key didn't sign.
3. It downloads the archive and checks it against the signed sha256 before unpacking it.
4. It keeps the daemon in a per-version folder: `~/.local/share/papercrane/<version>/` on Linux (or `$XDG_DATA_HOME/papercrane`), `~/Library/Application Support/papercrane/<version>/` on macOS, `%LOCALAPPDATA%\papercrane\<version>\` on Windows. These folders aren't npx's cache, so a service installed with `install-service` keeps working after the cache is cleared.

It needs Node 18 or newer and runs the newest published daemon, as long as that's at least this package's version. Run `install-service` again after a new release to point the service at the new version.

The daemon runs in your terminal. Ctrl+C reaches it directly, and a `SIGTERM` or `SIGHUP` sent to the launcher is passed on.

## License

PolyForm Noncommercial 1.0.0, like Paperboard itself.
