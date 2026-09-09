// os of the targeted computer, not the active shell
export function isWindowsTarget(serverDir: string, targetOs: string): boolean {
    return targetOs === "windows" || serverDir.includes("\\") || serverDir.includes(":");
}
