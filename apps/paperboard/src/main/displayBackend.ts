// Crostini (ChromeOS's Linux container) bridges Wayland through Sommelier,
// which never maps Electron's Wayland window: the app starts, its server
// listens, and no window appears. The same bridge's X11 side works.
//
// Electron picks its display backend before any app code runs. Appending
// --ozone-platform here is worse than too late: the browser process stays
// on Wayland while the GPU process is told X11 and crashes. The only way
// onto X11 is to start again with the switch on the command line.
import * as fs from "node:fs";
import type { App } from "electron";

// ChromeOS writes its milestone into every Crostini container
const CROSTINI_MARKER = "/dev/.cros_milestone";

/** Either sign is enough: the marker file, or the variable Sommelier exports into its sessions. */
export function isCrostini(
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
    fileExists: (file: string) => boolean = fs.existsSync,
): boolean {
    if (platform !== "linux") return false;
    return Boolean(env.SOMMELIER_VERSION) || fileExists(CROSTINI_MARKER);
}

/**
 * Relaunches this app on X11 when it is on Crostini without an explicit
 * Ozone choice. Returns true when it did; the caller must stop starting up.
 * The relaunch carries the switch, so it cannot loop.
 *
 * Packaged builds only: the dev launcher stops its dev server when the first
 * process exits, so in dev pass --ozone-platform=x11 instead.
 */
export function relaunchOnX11IfNeeded(
    app: App,
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
    fileExists: (file: string) => boolean = fs.existsSync,
): boolean {
    if (!app.isPackaged || !isCrostini(env, platform, fileExists)) return false;
    // an explicit choice from the caller wins. Read argv, not app.commandLine:
    // Chromium fills in its own ozone switches before app code runs.
    if (argv.some((arg) => arg.startsWith("--ozone-platform"))) return false;
    const args = [...argv.slice(1), "--ozone-platform=x11"];
    // an AppImage's execPath is inside its mount, which goes with this process
    if (env.APPIMAGE) app.relaunch({ execPath: env.APPIMAGE, args });
    else app.relaunch({ args });
    app.exit(0);
    return true;
}
