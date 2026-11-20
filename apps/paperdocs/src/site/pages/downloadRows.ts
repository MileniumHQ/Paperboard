import type { PlatformId } from "../platformIcons";

// The release files the downloads page links, one row per way to get a build.
// The download warning's tests check these against what it warns about.

/** A release file's address: the latest release, which the publish flow moves. */
export const releaseUrl = (path: string) => `https://i.paperboard.dev/${path}`;

/** One way to get a build: a row with a link per architecture. */
export interface DownloadRow {
    id: string;
    platform: PlatformId;
    title: string;
    description: string;
    files: { label: string; path: string }[];
}

export const APP: DownloadRow[] = [
    { id: "windows", platform: "windows", title: "Windows", description: "Installer", files: [{ label: "x64", path: "pb/latest/paperboard-windows-x64-setup.exe" }] },
    { id: "msi", platform: "windows", title: "Windows MSI", description: "For Group Policy, Intune and other managed installs", files: [{ label: "x64", path: "pb/latest/paperboard-windows-x64.msi" }] },
    {
        id: "macos", platform: "macos", title: "macOS", description: "App in a zip",
        files: [{ label: "Apple Silicon", path: "pb/latest/paperboard-macos-arm64.zip" }, { label: "Intel", path: "pb/latest/paperboard-macos-x64.zip" }],
    },
    {
        id: "appimage", platform: "linux", title: "Linux AppImage", description: "Any distribution. Needs FUSE 2; make the file executable before opening it.",
        files: [{ label: "x64", path: "pb/latest/paperboard-linux-x64.AppImage" }, { label: "ARM64", path: "pb/latest/paperboard-linux-arm64.AppImage" }],
    },
    {
        id: "deb", platform: "linux", title: "Linux deb", description: "Debian, Ubuntu, Linux Mint and Pop!_OS",
        files: [{ label: "x64", path: "pb/latest/paperboard-linux-x64.deb" }, { label: "ARM64", path: "pb/latest/paperboard-linux-arm64.deb" }],
    },
    {
        id: "rpm", platform: "linux", title: "Linux rpm", description: "Fedora, openSUSE and RHEL",
        files: [{ label: "x64", path: "pb/latest/paperboard-linux-x64.rpm" }, { label: "ARM64", path: "pb/latest/paperboard-linux-arm64.rpm" }],
    },
];

export const DAEMON: DownloadRow[] = [
    { id: "windows", platform: "windows", title: "Windows", description: "zip", files: [{ label: "x64", path: "crane/latest/crane-windows-x64.zip" }] },
    {
        id: "macos", platform: "macos", title: "macOS", description: "tar.gz",
        files: [{ label: "Apple Silicon", path: "crane/latest/crane-macos-arm64.tar.gz" }, { label: "Intel", path: "crane/latest/crane-macos-x64.tar.gz" }],
    },
    {
        id: "linux", platform: "linux", title: "Linux", description: "tar.gz. Needs glibc 2.17 or later.",
        files: [{ label: "x64", path: "crane/latest/crane-linux-x64.tar.gz" }, { label: "ARM64", path: "crane/latest/crane-linux-arm64.tar.gz" }],
    },
];

/** Every release address the page links. */
export const releaseUrls = (): string[] => [...APP, ...DAEMON].flatMap((row) => row.files.map((file) => releaseUrl(file.path)));
