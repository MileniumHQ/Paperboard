#!/bin/sh
# Installs Paperboard on Linux or macOS:
#
#   curl -fsSL https://i.paperboard.dev | sh
#
# `npx @mileniumhq/paperboard install` and `npm install -g @mileniumhq/paperboard`
# run this same file (packages/crane-launcher/install/install.sh; Origami serves
# it at i.paperboard.dev). install.ps1 is the Windows half.
#
# What it installs, and where (the launcher looks for Paperboard in the same
# places: packages/crane-launcher/src/app.ts):
#   Debian, Ubuntu (apt)          the .deb, with apt         /opt/Paperboard/paperboard
#   Fedora, openSUSE (dnf, zypper) the .rpm                   /opt/Paperboard/paperboard
#   any other Linux               the AppImage               ~/.local/share/paperboard/Paperboard.AppImage
#                                 plus a menu entry and ~/.local/bin/paperboard
#   macOS                         Paperboard.app             /Applications/Paperboard.app
# PAPERBOARD_INSTALL_AS=deb|rpm|appimage picks the Linux format yourself.
#
# Every download is checked against the release's SHA256SUMS before anything
# is installed.
set -eu

BASE="${PAPERBOARD_DOWNLOADS:-https://i.paperboard.dev/pb}"

say() { printf '%s\n' "$*"; }
fail() {
    printf 'Paperboard was not installed: %s\n' "$*" >&2
    exit 1
}

fetch() { # url file
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --proto '=https,http' -o "$2" "$1" || fail "could not download $1"
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$2" "$1" || fail "could not download $1"
    else
        fail "it needs curl or wget to download Paperboard."
    fi
}

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    else
        fail "it needs sha256sum or shasum to check the download."
    fi
}

# as root: directly when we are root, else through sudo
as_root() {
    if [ "$(id -u)" = 0 ]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        say "Installing needs administrator rights; sudo may ask for your password."
        sudo "$@"
    else
        fail "installing a system package needs root, and sudo isn't available. Run this as root, or set PAPERBOARD_INSTALL_AS=appimage to install for your account only."
    fi
}

os=$(uname -s)
case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "Paperboard has no build for $(uname -m) processors." ;;
esac

case "$os" in
    Linux)
        as="${PAPERBOARD_INSTALL_AS:-}"
        if [ -z "$as" ]; then
            if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
                as=deb
            elif command -v dnf >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1; then
                as=rpm
            else
                as=appimage
            fi
        fi
        case "$as" in
            deb) file="paperboard-linux-$arch.deb" ;;
            rpm) file="paperboard-linux-$arch.rpm" ;;
            appimage) file="paperboard-linux-$arch.AppImage" ;;
            *) fail "PAPERBOARD_INSTALL_AS must be deb, rpm or appimage, not \"$as\"." ;;
        esac
        ;;
    Darwin)
        # an Intel shell on Apple silicon (Rosetta) still gets the native app
        if [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
        as=app
        file="paperboard-macos-$arch.zip"
        ;;
    *) fail "this installs Paperboard on Linux and macOS. On Windows, run in PowerShell: irm https://i.paperboard.dev | iex" ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
# apt reads the package as its own user
chmod 755 "$tmp"

say "Downloading Paperboard ($file)..."
fetch "$BASE/SHA256SUMS" "$tmp/SHA256SUMS"
expected=$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
[ -n "$expected" ] || fail "the latest release has no $file."
fetch "$BASE/latest/$file" "$tmp/$file"
actual=$(sha256_of "$tmp/$file")
[ "$actual" = "$expected" ] || fail "the download doesn't match its checksum (expected $expected, got $actual)."
chmod 644 "$tmp/$file"

case "$as" in
    deb)
        as_root apt-get install -y "$tmp/$file" || fail "apt couldn't install $file."
        say "Paperboard is installed. Open it from your apps, or run: paperboard"
        ;;
    rpm)
        if command -v dnf >/dev/null 2>&1; then
            as_root dnf install -y "$tmp/$file" || fail "dnf couldn't install $file."
        elif command -v zypper >/dev/null 2>&1; then
            as_root zypper --non-interactive install --allow-unsigned-rpm "$tmp/$file" || fail "zypper couldn't install $file."
        else
            fail "installing the .rpm needs dnf or zypper."
        fi
        say "Paperboard is installed. Open it from your apps, or run: paperboard"
        ;;
    appimage)
        data="${XDG_DATA_HOME:-$HOME/.local/share}"
        dir="$data/paperboard"
        appimage="$dir/Paperboard.AppImage"
        mkdir -p "$dir" "$data/applications" "$data/icons/hicolor/512x512/apps" "$HOME/.local/bin"
        # a running Paperboard keeps the old file open; the new one takes its name
        cp "$tmp/$file" "$appimage.new"
        chmod 755 "$appimage.new"
        mv -f "$appimage.new" "$appimage"
        icon="usr/share/icons/hicolor/512x512/apps/paperboard.png"
        (cd "$tmp" && "$appimage" --appimage-extract "$icon" >/dev/null) || fail "couldn't read the icon out of $appimage."
        [ -f "$tmp/squashfs-root/$icon" ] || fail "$file has no icon at $icon."
        cp "$tmp/squashfs-root/$icon" "$data/icons/hicolor/512x512/apps/paperboard.png"
        cat >"$data/applications/paperboard.desktop" <<EOF
[Desktop Entry]
Name=Paperboard
Comment=Run and manage tools locally.
Exec="$appimage" --no-sandbox %U
Terminal=false
Type=Application
Icon=paperboard
StartupWMClass=Paperboard
Categories=Utility;
EOF
        ln -sf "$appimage" "$HOME/.local/bin/paperboard"
        say "Paperboard is installed in $dir. Open it from your apps, or run: paperboard"
        case ":$PATH:" in
            *":$HOME/.local/bin:"*) ;;
            *) say "($HOME/.local/bin isn't on your PATH, so the paperboard command needs it added.)" ;;
        esac
        ;;
    app)
        target=/Applications/Paperboard.app
        [ -w /Applications ] || fail "your account can't write to /Applications. Install from an administrator account."
        if pgrep -x Paperboard >/dev/null 2>&1; then fail "Paperboard is running. Quit it (from its menu bar icon), then run this again."; fi
        ditto -x -k "$tmp/$file" "$tmp/unpacked" || fail "couldn't unpack $file."
        [ -d "$tmp/unpacked/Paperboard.app" ] || fail "$file doesn't contain Paperboard.app."
        rm -rf "$target"
        ditto "$tmp/unpacked/Paperboard.app" "$target" || fail "couldn't copy Paperboard.app to /Applications."
        say "Paperboard is installed in /Applications. Open it from Launchpad or Spotlight."
        ;;
esac
