// ChromeOS runs Linux apps in a container (Crostini) whose Wayland bridge,
// sommelier, never maps Electron's Wayland window: the app starts, its
// server listens, and no window appears. The same bridge's X11 side works,
// so Paperboard picks X11 there. A user's own choice still wins.
import * as fs from "fs";
import type { App } from "electron";

// ChromeOS writes its milestone into every Crostini container
const CROSTINI_MARKER = "/dev/.cros_milestone";

// Electron fills in --ozone-platform itself before the main script runs, so
// the switch can't tell a user's choice apart; their argv and env can.
function userChoseDisplay(argv: readonly string[]): boolean {
    if (process.env.ELECTRON_OZONE_PLATFORM_HINT) return true;
    return argv.some((arg) => arg.startsWith("--ozone-platform=") || arg.startsWith("--ozone-platform-hint="));
}

export function chooseLinuxDisplay(app: App): void {
    if (process.platform !== "linux") return;
    if (userChoseDisplay(process.argv)) return;
    if (!fs.existsSync(CROSTINI_MARKER)) return;
    app.commandLine.appendSwitch("ozone-platform", "x11");
}
