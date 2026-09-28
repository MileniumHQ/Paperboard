import { execFile, spawn } from "child_process";
import * as fs from "fs";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { logger } from "../../papercrane/logger";
import { panelFilesDirName } from "../../papercrane/storage";
import {
    buildWindowsMountCommand,
    buildMacMountScript,
    macMountScriptPath,
} from "./remoteFolderMount";

// remote data dir over WebDAV with ephemeral session; teardown on explorer close
const IDLE_MS = 180_000;
const POLL_MS = 4_000;
const GRACE_MS = 90_000;
const CONFIRM_MISSES = 2;

interface ActiveSession {
    computerId: string;
    host: string;
    port: number;
    mainToken: string;
    davUser: string;
    mount: string; // drive "Z:", /Volumes/Name, or "" (linux)
    timer: NodeJS.Timeout | null;
    seen: boolean;
    misses: number;
    deadline: number;
}

const active = new Map<string, ActiveSession>();

function bracket(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function execAsync(
    cmd: string,
    args: string[],
    timeoutMs: number,
    input?: string,
    env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            cmd,
            args,
            { timeout: timeoutMs, ...(env ? { env: { ...process.env, ...env } } : {}) },
            (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout: String(stdout), stderr: String(stderr) });
            },
        );
        if (input && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}

async function revokeSession(s: ActiveSession): Promise<void> {
    try {
        await fetch(`http://${bracket(s.host)}:${s.port}/dav/session`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${s.mainToken}` },
            body: JSON.stringify({ user: s.davUser }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch (err) {
        // unreachable — server expiry reaps it
        logger.debug("[remoteFolder] session keepalive failed:", err);
    }
}

async function unmount(s: ActiveSession): Promise<void> {
    try {
        if (process.platform === "win32" && s.mount) {
            await execAsync("net", ["use", `${s.mount}`, "/delete", "/y"], 20_000);
        } else if (process.platform === "darwin" && s.mount) {
            try {
                await execAsync("umount", [s.mount], 20_000);
            } catch {
                await execAsync("diskutil", ["unmount", s.mount], 20_000);
            }
        } else if (process.platform === "linux") {
            const uid = process.getuid?.() ?? 1000;
            const gvfs = `/run/user/${uid}/gvfs`;
            try {
                const entries = fs.readdirSync(gvfs);
                const hit = entries.find(
                    (e) => e.startsWith("dav:host=") && e.includes(`,user=${s.davUser}`),
                );
                if (hit) {
                    await execAsync("gio", ["mount", "-u", `dav://${s.host}:${s.port}/dav/`], 20_000);
                }
            } catch (err) { logger.debug("[remoteFolder.ts] op failed:", err) }
        }
    } catch (err: any) {
        logger.warn("[RemoteFolder] unmount failed:", err?.message ?? err);
    }
}

export async function closeRemoteFolder(computerId: string): Promise<void> {
    const s = active.get(computerId);
    if (!s) return;
    active.delete(computerId);
    if (s.timer) clearInterval(s.timer);
    await unmount(s);
    await revokeSession(s);
}

export async function closeAllRemoteFolders(): Promise<void> {
    await Promise.allSettled([...active.keys()].map((id) => closeRemoteFolder(id)));
}

async function windowsHasWindow(drive: string): Promise<boolean> {
    // mapped DAV drive LocationURL looks like file:///Z:/...
    const ps = `(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { try { $_.LocationURL } catch { '' } }`;
    const { stdout } = await execAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        20_000,
    );
    const needle = `${drive.replace(":", "").toLowerCase()}:`;
    return stdout
        .split(/\r?\n/)
        .some((line) => line.toLowerCase().includes(needle));
}

async function macHasWindow(mountPoint: string): Promise<boolean> {
    const script = `tell application "Finder" to get POSIX path of (get target of every window)`;
    try {
        const { stdout } = await execAsync("osascript", ["-e", script], 15_000);
        return stdout.split(/,\s*|\r?\n/).some((line) => line.includes(mountPoint));
    } catch (err) {
        logger.debug("[RemoteFolder] Finder window probe failed, assuming closed:", err);
        return false;
    }
}

function startWatcher(s: ActiveSession, hasWindow: () => Promise<boolean>): void {
    s.timer = setInterval(async () => {
        try {
            const open = await hasWindow();
            if (open) {
                s.seen = true;
                s.misses = 0;
                return;
            }
            if (!s.seen && Date.now() < s.deadline) return; // still in grace
            s.misses += 1;
            if (s.seen || Date.now() >= s.deadline) {
                if (s.misses >= CONFIRM_MISSES || Date.now() >= s.deadline) {
                    logger.info(`[RemoteFolder] explorer closed for ${s.computerId}; tearing down`);
                    await closeRemoteFolder(s.computerId);
                }
            }
        } catch (err: any) {
            logger.warn("[RemoteFolder] watch poll failed:", err?.message ?? err);
        }
    }, POLL_MS);
}

export async function openRemoteFolder(
    computerId: string,
    panelId?: string,
): Promise<{ ok: boolean; error?: string }> {
    const client = connectionPool.getClient(computerId);
    const status = client.getStatus();
    if (!status.isRemote) return { ok: false, error: "not-remote" };
    const mainToken = client.getToken();
    if (!mainToken) return { ok: false, error: "not-paired" };
    const host = client.getHost();
    const port = client.getPort();

    await closeRemoteFolder(computerId);

    let session: { user: string; pass: string };
    try {
        const res = await fetch(`http://${bracket(host)}:${port}/dav/session`, {
            method: "POST",
            headers: { Authorization: `Bearer ${mainToken}` },
            body: JSON.stringify({ idleMs: IDLE_MS }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false, error: `session-${res.status}` };
        session = (await res.json()) as { user: string; pass: string };
        if (!session?.user || !session?.pass) return { ok: false, error: "bad-session" };
    } catch (err: any) {
        return { ok: false, error: `unreachable: ${err?.message ?? err}` };
    }

    const rec: ActiveSession = {
        computerId,
        host,
        port,
        mainToken,
        davUser: session.user,
        mount: "",
        timer: null,
        seen: false,
        misses: 0,
        deadline: Date.now() + GRACE_MS,
    };

    // subdir ensured server-side so explorer lands somewhere real
    const subDir = panelId ? `files/${panelFilesDirName(panelId)}` : "";

    const fail = async (error: string) => {
        active.set(computerId, rec);
        await closeRemoteFolder(computerId);
        return { ok: false, error };
    };

    // MKCOL 405s ignored; best-effort
    if (subDir) {
        const basic =
            "Basic " +
            Buffer.from(`${session.user}:${session.pass}`).toString("base64");
        let prefix = "";
        for (const seg of subDir.split("/").filter(Boolean)) {
            prefix += `/${encodeURIComponent(seg)}`;
            try {
                await fetch(`http://${bracket(host)}:${port}/dav${prefix}`, {
                    method: "MKCOL",
                    headers: { Authorization: basic },
                    signal: AbortSignal.timeout(10_000),
                });
            } catch (err) { logger.debug("[remoteFolder.ts] op failed:", err) }
        }
    }

    try {
        if (process.platform === "win32") {
            // credential in child env, never argv: cmdkey/net-use password
            // args are world-readable via WMI/Task Manager
            const url = `http://${host}:${port}/dav`;
            const plan = buildWindowsMountCommand(url, session.user, session.pass);
            const out = await execAsync("powershell.exe", plan.args, 60_000, undefined, plan.env);
            const drive = /([A-Z]:)/i.exec(out.stdout)?.[1]?.toUpperCase();
            if (!drive) {
                logger.warn("[RemoteFolder] mount output:", out.stdout);
                return await fail("mount-parse");
            }
            rec.mount = drive;
            active.set(computerId, rec);
            const target = subDir
                ? `${drive}\\${subDir.split("/").join("\\")}\\`
                : `${drive}\\`;
            spawn("explorer", [target], { detached: true, stdio: "ignore" }).unref();
            startWatcher(rec, () => windowsHasWindow(drive));
            return { ok: true };
        }

        if (process.platform === "darwin") {
            const safeId = computerId.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 32) || "remote";
            const mountPoint = `/Volumes/Paperboard-${safeId}`;
            fs.mkdirSync(mountPoint, { recursive: true });
            // credential in a 0600 temp file, never argv/URL (both leak
            // into ps output)
            const scriptPath = macMountScriptPath();
            fs.writeFileSync(scriptPath, buildMacMountScript(session.user, session.pass, host, port), {
                mode: 0o600,
            });
            try {
                await execAsync("osascript", [scriptPath], 60_000);
            } finally {
                try {
                    fs.unlinkSync(scriptPath);
                } catch (err) { logger.debug("[remoteFolder.ts] op failed:", err) }
            }
            rec.mount = mountPoint;
            active.set(computerId, rec);
            const target = subDir ? `${mountPoint}/${subDir}` : mountPoint;
            spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
            startWatcher(rec, () => macHasWindow(mountPoint));
            return { ok: true };
        }

        // linux: no window API to watch; rely on server expiry + quit cleanup
        // TODO(remove after v0.3): the credential-bearing dav URI in argv is
        // a documented residual — xdg-open passes it to ps output. Loan
        // expired; it is denied (like every other credential-in-argv path)
        // after v0.3.
        const uri = `dav://${encodeURIComponent(session.user)}:${encodeURIComponent(session.pass)}@${host}:${port}/dav/${subDir ? subDir + "/" : ""}`;
        active.set(computerId, rec);
        spawn("xdg-open", [uri], { detached: true, stdio: "ignore" }).unref();
        return { ok: true };
    } catch (err: any) {
        logger.warn("[RemoteFolder] open failed:", err?.message ?? err);
        return await fail(`mount: ${err?.message ?? err}`);
    }
}
