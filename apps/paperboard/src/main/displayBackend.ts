// Crostini (ChromeOS Linux VM) bridges Wayland through Sommelier, which does
// not support everything Chromium's native Wayland backend needs: the window
// is created but never shows. Electron picks Wayland whenever WAYLAND_DISPLAY
// is set, and does so before any app code runs, so appending the switch here
// is too late. The only way to get X11 (Xwayland) is to start again with
// --ozone-platform=x11.
import type { App } from "electron";

export function isCrostini(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
    return platform === "linux" && Boolean(env.SOMMELIER_VERSION);
}

/**
 * Relaunches this app on X11 when it is on Crostini without an explicit
 * Ozone choice. Packaged builds only: the dev launcher stops its dev server
 * when the first process exits, so in dev pass --ozone-platform=x11 instead. Returns true when it did; the caller must stop starting up.
 * The relaunch carries the switch, so it cannot loop.
 */
export function relaunchOnX11IfNeeded(
    app: App,
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
): boolean {
    if (!app.isPackaged || !isCrostini(env, platform)) return false;
    // an explicit choice from the caller wins. Read argv, not app.commandLine:
    // Chromium fills in its own ozone switches before app code runs.
    if (argv.some((arg) => arg.startsWith("--ozone-platform"))) return false;
    app.relaunch({ args: [...argv.slice(1), "--ozone-platform=x11"] });
    app.exit(0);
    return true;
}
