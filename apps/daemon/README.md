This is Crane. The backend for Paperboard.

The README here exists because I just want to acknowledge how incredibly confusing the naming scheme for PaperCrane is. PaperCrane? Ah, see, there it is.

I either call it Crane, or PaperCrane, or Paperboard server daemon. NOT "Paperboard Server Daemon" no, "Paperboard server daemon". It's capitalized that way.

In general, internally it's "PaperCrane" or "Crane", in text its "Paperboard server daemon". Got it?

| Usage                    | Name                     |
| ------------------------ | ------------------------ |
| Internal / Code Name     | PaperCrane               |
| Display Name             | Paperboard Server Daemon |
| Use this sometimes idk?? | Crane                    |

Is this really dumb and confusing? Yes. Why is it this way? I don't know. I don't make the rules. Okay well I do but still.

\- Pxl

## Building it
The release build (`bun run publish` from the repo root) compiles it for every target. To compile it yourself, from `apps/daemon`, with the workload supervisor (Go) embedded:
```zsh
bun build --compile --target=bun-linux-x64 ./src/main.ts "$(bun ../../scripts/build/supervisor.ts --path linux-x64)" --outfile ./dist/papercrane-linux-x64
bun build --compile --target=bun-linux-arm64 ./src/main.ts "$(bun ../../scripts/build/supervisor.ts --path linux-arm64)" --outfile ./dist/papercrane-linux-arm64
bun build --compile --target=bun-darwin-x64 ./src/main.ts "$(bun ../../scripts/build/supervisor.ts --path macos-x64)" --outfile ./dist/papercrane-macos-x64
bun build --compile --target=bun-darwin-arm64 ./src/main.ts "$(bun ../../scripts/build/supervisor.ts --path macos-arm64)" --outfile ./dist/papercrane-macos-arm64
bun build --compile --target=bun-windows-x64 ./src/main.ts "$(bun ../../scripts/build/supervisor.ts --path windows-x64)" --outfile ./dist/papercrane-windows-x64.exe
```

## Running it
The server (`papercrane`, the Paperboard server daemon) is one binary. `papercrane --help` lists everything; the short version:
```zsh
papercrane                      # start it with the interactive screen ([p] pairs a computer)
papercrane install-service      # run it in the background, starting with the computer
papercrane pair                 # show a pairing code on the running daemon
papercrane status               # is it running? (exits 3 when it isn't)
papercrane uninstall-service    # remove the service; your data stays
```
- No binary yet? `npx @mileniumhq/paperboard serve` downloads the signed release for your computer, checks it against the release key, and runs it (see [packages/npx](../../packages/npx/README.md)). Any command above works the same way.
- `serve` is the default command, so `papercrane --headless --port 45465` still works like it always did.
- `install-service` writes a systemd unit on Linux (`~/.config/systemd/user/papercrane.service`, or `/etc/systemd/system/` with `--system`) and a launchd job on macOS (`~/Library/LaunchAgents/dev.paperboard.papercrane.plist`, or `/Library/LaunchDaemons/` with `--system`), enables it and waits for the daemon to answer. Windows prints the Task Scheduler command to use instead. `--dry-run` prints the file without touching anything.
- The service runs `--headless` and stops only the daemon process (`KillMode=process`, `AbandonProcessGroup`), so game servers keep running through a restart and the next daemon adopts them.
- A user service on Linux stops when your last session ends unless lingering is on (`sudo loginctl enable-linger $USER`); install-service tells you when it isn't. On a headless box, `--system` is the better fit.
- Logs: `journalctl --user -u papercrane -f` (Linux), `~/Library/Logs/Paperboard/papercrane.log` (macOS), plus the daemon's own logs in `~/.paperboard/logs`.
- `--data-dir` (or `PAPERBOARD_DIR`) moves the data directory. `PAPERCRANE_PORT` and `PAPERCRANE_HOST` set the listen address when the flags aren't given.
- A wrong flag prints the error and usage and exits 2. Nothing starts.
