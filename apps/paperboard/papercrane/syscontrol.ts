import { execFile } from "child_process";
import * as path from "path";
import { logger } from "./logger";

// host controls via portable libs, per-OS shell fallback
function runShell(cmd: string, timeoutMs = 20_000): Promise<string> {
    return new Promise((resolve) => {
        const proc =
            process.platform === "win32"
                ? execFile("cmd.exe", ["/d", "/s", "/c", cmd], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
                      resolve(err ? String(stderr || "") : String(stdout || ""));
                  })
                : execFile("sh", ["-c", cmd], { timeout: timeoutMs }, (err, stdout, stderr) => {
                      resolve(err ? String(stderr || "") : String(stdout || ""));
                  });
        proc.on("error", () => resolve(""));
    });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function psString(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
}

export async function notifyComputer(title: string, message: string): Promise<void> {
    try {
        const { default: notifier } = await import("node-notifier");
        await withTimeout(
            // appID stamps our identity on the toast
            notifier.notify({
                title,
                message,
                sound: false,
                wait: false,
                appID: "dev.paperboard.paperboard",
            }),
            15_000,
            "notify",
        );
        return;
    } catch (err: any) {
        logger.warn("[syscontrol] node-notifier unavailable, shell fallback:", err?.message ?? err);
    }
    // shell fallbacks
    if (process.platform === "win32") {
        await runShell(
            `powershell -Command "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $text = $template.GetElementsByTagName('text'); $text[0].AppendChild($template.CreateTextNode(${psString(title)})) > $null; $text[1].AppendChild($template.CreateTextNode(${psString(message)})) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Paperboard').Show($toast);" 2>nul || powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${psString(message)}, ${psString(title)})"`,
        );
    } else if (process.platform === "darwin") {
        const esc = (s: string) => s.replace(/"/g, '\\"');
        await runShell(`osascript -e 'display notification "${esc(message)}" with title "${esc(title)}"'`);
    } else {
        await runShell(`notify-send '${title.replace(/'/g, "")}' '${message.replace(/'/g, "")}'`);
    }
}

export async function screenshotComputer(savePath: string): Promise<string> {
    const abs = path.isAbsolute(savePath) ? savePath : path.join(process.cwd(), savePath);
    try {
        const { default: screenshot } = await import("screenshot-desktop");
        await withTimeout(screenshot({ filename: abs }), 30_000, "screenshot");
        return abs;
    } catch (err: any) {
        logger.warn("[syscontrol] screenshot-desktop unavailable, shell fallback:", err?.message ?? err);
    }
    if (process.platform === "win32") {
        await runShell(
            `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $b = New-Object Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save(${psString(abs)}); $g.Dispose(); $b.Dispose()"`,
        );
    } else if (process.platform === "darwin") {
        await runShell(`screencapture -x '${abs.replace(/'/g, "")}'`);
    } else {
        await runShell(
            `spectacle -b -n -o '${abs.replace(/'/g, "")}' 2>/dev/null || grim '${abs.replace(/'/g, "")}' 2>/dev/null || import -window root '${abs.replace(/'/g, "")}' 2>/dev/null || scrot '${abs.replace(/'/g, "")}' 2>/dev/null`,
        );
    }
    return abs;
}

export async function setComputerVolume(volume: number): Promise<number> {
    const vol = Math.max(0, Math.min(100, Math.round(volume)));
    try {
        const { default: loudness } = await import("loudness");
        await withTimeout(loudness.setVolume(vol), 15_000, "set-volume");
        return vol;
    } catch (err: any) {
        logger.warn("[syscontrol] loudness unavailable, shell fallback:", err?.message ?? err);
    }
    if (process.platform === "win32") {
        await runShell(
            `powershell -c "$w = New-Object -ComObject WScript.Shell; 1..50 | % { $w.SendKeys([char]174) }; 1..${Math.round(vol / 2)} | % { $w.SendKeys([char]175) }" 2>nul`,
        );
    } else if (process.platform === "darwin") {
        await runShell(`osascript -e "set volume output volume ${vol}"`);
    } else {
        await runShell(
            `wpctl set-volume @DEFAULT_AUDIO_SINK@ $(awk -v v=${vol} 'BEGIN {print v/100}') 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ ${vol}% 2>/dev/null || amixer set Master ${vol}% 2>/dev/null`,
        );
    }
    return vol;
}

export async function setComputerMuted(muted: boolean): Promise<boolean> {
    try {
        const { default: loudness } = await import("loudness");
        await withTimeout(loudness.setMuted(muted), 15_000, "set-muted");
        return muted;
    } catch (err: any) {
        logger.warn("[syscontrol] loudness unavailable, shell fallback:", err?.message ?? err);
    }
    if (process.platform === "win32") {
        await runShell(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)" 2>nul`);
    } else if (process.platform === "darwin") {
        await runShell(`osascript -e "set volume output muted ${muted ? "true" : "false"}"`);
    } else {
        await runShell(
            `wpctl set-mute @DEFAULT_AUDIO_SINK@ ${muted ? 1 : 0} 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ ${muted ? 1 : 0} 2>/dev/null || amixer set Master ${muted ? "mute" : "unmute"} 2>/dev/null`,
        );
    }
    return muted;
}

export async function beepComputer(): Promise<void> {
    if (process.platform === "win32") {
        // MessageBeep uses the sound scheme, no console needed
        await runShell(`rundll32.exe user32.dll,MessageBeep`);
    } else if (process.platform === "darwin") {
        await runShell(`afplay /System/Library/Sounds/Ping.aiff 2>/dev/null || printf '\\a'`);
    } else {
        await runShell(
            `canberra-gtk-play -i bell 2>/dev/null || paplay /usr/share/sounds/freedesktop/stereo/bell.oga 2>/dev/null || aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null || printf '\\a'`,
        );
    }
}
