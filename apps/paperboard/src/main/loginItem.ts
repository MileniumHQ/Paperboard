import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Electron's login items cover macOS and Windows only; on Linux, Paperboard
// is an XDG autostart entry instead.
export interface LoginItemHost {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    /** the app binary; an AppImage is started by its own file ($APPIMAGE) */
    execPath: string;
    get(): { openAtLogin: boolean; status?: string };
    set(openAtLogin: boolean): void;
}

export function autostartEntryPath(env: NodeJS.ProcessEnv): string {
    const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(config, "autostart", "dev.paperboard.paperboard.desktop");
}

// the Exec key's quoting (Desktop Entry spec): the argument in double
// quotes, with ", `, $ and \ escaped
function execArgument(file: string): string {
    return `"${file.replace(/["`$\\]/g, (c) => `\\${c}`)}"`;
}

/** Makes Paperboard start at login, or not; throws when the system won't. */
export function setRunOnStartup(enabled: boolean, host: LoginItemHost): void {
    if (host.platform === "linux") {
        const entry = autostartEntryPath(host.env);
        if (!enabled) {
            fs.rmSync(entry, { force: true });
            return;
        }
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, [
            "[Desktop Entry]",
            "Type=Application",
            "Name=Paperboard",
            `Exec=${execArgument(host.env.APPIMAGE || host.execPath)}`,
            "X-GNOME-Autostart-enabled=true",
            "",
        ].join("\n"));
        return;
    }
    // asking for what is already so would still fail on an unsigned Mac
    if (host.get().openAtLogin === enabled) return;
    host.set(enabled);
    const now = host.get();
    if (now.openAtLogin === enabled) return;
    if (host.platform === "darwin") {
        if (now.status === "requires-approval") {
            throw new Error("Allow Paperboard in System Settings › General › Login Items, then it starts when you log in.");
        }
        throw new Error(`macOS wouldn't ${enabled ? "add Paperboard to" : "remove Paperboard from"} your login items. You can ${enabled ? "add" : "remove"} it yourself in System Settings › General › Login Items.`);
    }
    throw new Error(`Windows wouldn't ${enabled ? "start Paperboard" : "stop starting Paperboard"} when you sign in.`);
}
