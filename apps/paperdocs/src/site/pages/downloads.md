## Paperboard

The desktop app. Includes the server daemon for this computer.

- Windows: [x64](https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe)
- macOS: [Apple Silicon](https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip) · [Intel](https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip)
- Linux AppImage: [x64](https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage) · [ARM64](https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.AppImage)
- Linux deb (Debian, Ubuntu): [x64](https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb) · [ARM64](https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.deb)
- Linux rpm (Fedora, openSUSE): [x64](https://i.paperboard.dev/pb/latest/paperboard-linux-x64.rpm) · [ARM64](https://i.paperboard.dev/pb/latest/paperboard-linux-arm64.rpm)

Installed from the deb or rpm, Paperboard updates itself like any other install.

## From a terminal

On Linux and macOS, run `curl -fsSL https://i.paperboard.dev | sh`. On Windows, run `irm https://i.paperboard.dev | iex` in PowerShell. With Node, run `npx @mileniumhq/paperboard`, which opens Paperboard and asks first if it isn't installed yet. The install script checks the download against the release's checksums before it installs.

## Paperboard server daemon

For a headless computer you want to manage from Paperboard on another device.

- Windows: [x64](https://i.paperboard.dev/crane/latest/crane-windows-x64.zip)
- macOS: [Apple Silicon](https://i.paperboard.dev/crane/latest/crane-macos-arm64.tar.gz) · [Intel](https://i.paperboard.dev/crane/latest/crane-macos-x64.tar.gz)
- Linux: [x64](https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz) · [ARM64](https://i.paperboard.dev/crane/latest/crane-linux-arm64.tar.gz)

Linux AppImages need FUSE 2. Make the downloaded file executable before opening it.
