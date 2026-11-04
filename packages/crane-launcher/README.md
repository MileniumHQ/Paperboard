# @mileniumhq/paperboard

Run the Paperboard server daemon without installing anything first:

```sh
npx @mileniumhq/paperboard serve
```

The first run downloads the daemon for your computer, checks it, and runs it. After that it starts straight away.

Every argument goes to the daemon unchanged, so anything `papercrane` takes works here:

```sh
npx @mileniumhq/paperboard --help
npx @mileniumhq/paperboard install-service    # run it in the background, starting with the computer
npx @mileniumhq/paperboard pair               # show a pairing code on the running daemon
npx @mileniumhq/paperboard status
```

## What it does

This package holds no daemon code. It fetches the same signed `papercrane` binary that Paperboard's own releases ship:

1. It reads the release index at `https://origami.ariapis.com/paperdl/crane/index.json` (the one the desktop app's updater reads).
2. It checks the entry's signature against the Paperboard release key, using the daemon's own verifier. Nothing is downloaded from an entry the key didn't sign.
3. It downloads the archive and checks it against the signed sha256 before unpacking it.
4. It keeps the daemon in a per-version folder: `~/.local/share/papercrane/<version>/` on Linux (or `$XDG_DATA_HOME/papercrane`), `~/Library/Application Support/papercrane/<version>/` on macOS, `%LOCALAPPDATA%\papercrane\<version>\` on Windows. These folders aren't npx's cache, so a service installed with `install-service` keeps working after the cache is cleared.

It needs Node 18 or newer and runs the newest published daemon, as long as that's at least this package's version. Run `install-service` again after a new release to point the service at the new version.

The daemon runs in your terminal. Ctrl+C reaches it directly, and a `SIGTERM` or `SIGHUP` sent to the launcher is passed on.

## License

PolyForm Noncommercial 1.0.0, like the daemon itself.
