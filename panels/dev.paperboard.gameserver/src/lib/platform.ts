// os of the targeted computer, not the active shell. The daemon-reported
// OS string is authoritative; path shape is only a fallback for unknown
// strings — and only backslash counts, because a colon appears in
// legitimate posix paths and proves nothing about Windows.
export function isWindowsTarget(serverDir: string, targetOs: string): boolean {
    const os = (targetOs || "").toLowerCase();
    if (os.includes("win")) return true;
    if (os === "linux" || os === "darwin" || os === "macos" || os.includes("mac")) return false;
    return serverDir.includes("\\");
}
