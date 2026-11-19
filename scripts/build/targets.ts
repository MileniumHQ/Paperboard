// The release targets Paperboard ships for, and how Bun names each. The
// builds (the supervisor, the crane, the desktop app's test builds) read this
// file alone, so a change to the publisher doesn't reach everything that
// compiles a daemon.

export type Target = "linux-x64" | "linux-arm64" | "macos-x64" | "macos-arm64" | "windows-x64";

// Every shipped target, including linux-arm64 (untested but non-negotiable).
export const ALL_TARGETS: Target[] = ["linux-x64", "linux-arm64", "macos-x64", "macos-arm64", "windows-x64"];

export type Os = "macos" | "windows" | "linux";

export function osOf(t: Target): Os {
    return t.startsWith("macos") ? "macos" : t.startsWith("windows") ? "windows" : "linux";
}

export type Arch = "x64" | "arm64";

export function archOf(t: Target): Arch {
    return t.endsWith("arm64") ? "arm64" : "x64";
}

export const BUN_TARGET_MAP: Record<Target, string> = {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "macos-x64": "bun-darwin-x64",
    "macos-arm64": "bun-darwin-arm64",
    "windows-x64": "bun-windows-x64",
};
