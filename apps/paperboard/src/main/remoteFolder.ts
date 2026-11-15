import { execFile, spawn } from "child_process";
import * as fs from "fs";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { logger } from "../../papercrane/logger";
import { panelFilesDirName } from "../../papercrane/storage";
import {
    buildWindowsMountCommand,
    buildMacMountScript,
    macMountScriptPath,
    powershellErrorLine,
    windowsDavRoot,
    remoteFolderSupported,
} from "./remoteFolderMount";
import { startDavRelay, relayFolderUrl, type DavRelay } from "./davRelay";
import { pinnedRequest } from "../../papercrane/pinnedTls";
import { bracketHost } from "./communication/papercrane/probeTarget";

// remote data dir over WebDAV with ephemeral session; teardown on explorer
// close. The OS mounts a loopback relay that makes the pinned TLS hop.
const IDLE_MS = 180_000;
const POLL_MS = 4_000;
const GRACE_MS = 90_000;
const CONFIRM_MISSES = 2;

interface ActiveSession {
    computerId: string;
    host: string;
    port: number;
    cert: string;
    mainToken: string;
    davUser: string;
    // kept in memory to make a panel's folder in an open session
    davPass: string;
    mount: string; // drive "Z:", /Volumes/Name, or "" (linux)
    relay: DavRelay | null; // loopback relay to the remote daemon
    timer: NodeJS.Timeout | null;
    seen: boolean;
    misses: number;
    deadline: number;
}

const active = new Map<string, ActiveSession>();

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
                // the caller reads what the program said, not just its exit
                if (err) reject(Object.assign(err, { stderr: String(stderr) }));
                else resolve({ stdout: String(stdout), stderr: String(stderr) });
            },
        );
        if (input && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}

// xdg-open's exit code says whether any handler took the URL; a detached
// fire-and-forget spawn would report success for a URL nobody opened
function openWithDesktop(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn("xdg-open", [url], { stdio: "ignore" });
        child.on("error", (err) => {
            logger.warn("[RemoteFolder] xdg-open failed to start:", err.message);
            resolve(false);
        });
        child.on("exit", (code) => {
            if (code !== 0) logger.warn(`[RemoteFolder] xdg-open could not open the folder (exit ${code})`);
            resolve(code === 0);
        });
    });
}

async function revokeSession(s: ActiveSession): Promise<void> {
    try {
        await pinnedRequest(`https://${bracketHost(s.host)}:${s.port}/dav/session`, s.cert, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${s.mainToken}` },
            body: JSON.stringify({ user: s.davUser }),
            timeoutMs: 10_000,
        });
    } catch (err) {
        // unreachable — server expiry reaps it
        logger.debug("[remoteFolder] session revoke failed:", err);
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
        }
    } catch (err: any) {
        logger.warn("[RemoteFolder] unmount failed:", err?.message ?? err);
    }
}

export async function closeRemoteFolder(computerId: string): Promise<void> {
    const s = active.get(computerId);
    if (s) await closeSession(s);
}

// a session ends on its own: its relay or window going idle never takes
// down a newer one for the same computer
async function closeSession(s: ActiveSession): Promise<void> {
    if (active.get(s.computerId) === s) active.delete(s.computerId);
    if (s.timer) clearTimeout(s.timer);
    await s.relay?.close();
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

// each open Finder window's folder, one per line; no window is no line
const FINDER_WINDOWS = [
    'set out to ""',
    'tell application "Finder"',
    "repeat with w in (every Finder window)",
    "try",
    "set out to out & (POSIX path of (target of w as alias)) & linefeed",
    "end try",
    "end repeat",
    "end tell",
    "return out",
];

async function macHasWindow(mountPoint: string): Promise<boolean> {
    const { stdout } = await execAsync("osascript", FINDER_WINDOWS.flatMap((line) => ["-e", line]), 15_000);
    return stdout.split(/\r?\n/).some((line) => line.startsWith(mountPoint));
}

// The folder closes once its window does: after a grace period for the
// window to appear, two looks in a row without it. A look that fails (Finder
// refused Paperboard its Automation access, PowerShell broke) can't tell
// open from closed, so the folder stays and the relay's idle timer ends it,
// as on Linux: the folder someone is browsing is never pulled away.
function startWatcher(s: ActiveSession, hasWindow: () => Promise<boolean>): void {
    const look = async () => {
        let open: boolean;
        try {
            open = await hasWindow();
        } catch (err: any) {
            logger.warn(`[RemoteFolder] can't see whether ${s.computerId}'s folder window is open; it stays until it goes unused:`, err?.message ?? err);
            s.timer = null;
            return;
        }
        if (active.get(s.computerId) !== s) return;
        if (open) {
            s.seen = true;
            s.misses = 0;
        } else if (s.seen || Date.now() >= s.deadline) {
            s.misses += 1;
            if (!s.seen || s.misses >= CONFIRM_MISSES) {
                logger.info(`[RemoteFolder] explorer closed for ${s.computerId}; tearing down`);
                await closeSession(s);
                return;
            }
        }
        s.timer = setTimeout(look, POLL_MS);
    };
    s.timer = setTimeout(look, POLL_MS);
}

// starts a program the person will see and leaves it running; rejects when
// it could not start at all
function launch(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}

// the panel's folder is made on the remote first; 405 means it is already
// there. Answers why it couldn't be, or null.
async function makeSubDir(origin: string, cert: string, user: string, pass: string, subDir: string): Promise<string | null> {
    const basic = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
    let prefix = "";
    for (const seg of subDir.split("/").filter(Boolean)) {
        prefix += `/${encodeURIComponent(seg)}`;
        let status: number;
        try {
            ({ status } = await pinnedRequest(`${origin}/dav${prefix}`, cert, {
                method: "MKCOL",
                headers: { Authorization: basic },
                timeoutMs: 10_000,
            }));
        } catch (err: any) {
            return `The panel's folder couldn't be made on that computer: ${err?.message ?? String(err)}`;
        }
        if (status !== 201 && status !== 405) return `The panel's folder couldn't be made on that computer (HTTP ${status}).`;
    }
    return null;
}

// opens a window on the mounted folder (or, on Linux, the relay's URL).
// Answers why it couldn't, or null.
async function showFolder(rec: ActiveSession, subDir: string): Promise<string | null> {
    if (process.platform === "linux") {
        const opened = await openWithDesktop(relayFolderUrl(process.env.XDG_CURRENT_DESKTOP, rec.relay!.port, subDir));
        return opened ? null : "No file manager opened the folder.";
    }
    const windows = process.platform === "win32";
    const target = windows
        ? `${rec.mount}\\${subDir ? `${subDir.split("/").join("\\")}\\` : ""}`
        : subDir ? `${rec.mount}/${subDir}` : rec.mount;
    // Explorer and Finder open somewhere else for a path that isn't there,
    // so a missing folder is an error here, not a wrong window. Async: the
    // drive is served by the relay in this very process, and a sync check
    // would block the loop that has to answer it.
    if (!(await fs.promises.access(target).then(() => true, () => false))) {
        return `${windows ? "Windows" : "macOS"} mounted the folder, but ${target} isn't in it.`;
    }
    try {
        if (windows) await launch("explorer", [target]);
        else await execAsync("open", [target], 20_000);
    } catch (err: any) {
        return `${windows ? "Explorer" : "Finder"} couldn't open ${target}: ${err?.stderr?.trim() || err?.message || err}`;
    }
    return null;
}

// opens for one computer run one at a time: two at once would each mint a
// session, and the first would be left mounted with nothing to end it
const opening = new Map<string, Promise<unknown>>();

export function openRemoteFolder(computerId: string, panelId?: string): Promise<{ ok: boolean; error?: string }> {
    const run = (opening.get(computerId) ?? Promise.resolve()).then(() => openNow(computerId, panelId));
    const settled = Promise.allSettled([run]);
    opening.set(computerId, settled);
    void settled.then(() => {
        if (opening.get(computerId) === settled) opening.delete(computerId);
    });
    return run;
}

async function openNow(computerId: string, panelId?: string): Promise<{ ok: boolean; error?: string }> {
    // checked before a DAV session is minted: nothing to mount it with
    if (!remoteFolderSupported(process.platform)) return { ok: false, error: "This system can't open another computer's files as a folder." };
    const client = connectionPool.getClient(computerId);
    const status = client.getStatus();
    if (!status.isRemote) return { ok: false, error: "This computer isn't connected as a remote computer." };
    const mainToken = client.getToken();
    if (!mainToken) return { ok: false, error: "This computer isn't paired. Pair it again from its settings." };
    const host = client.getHost();
    const port = client.getPort();
    const cert = client.getCert();
    if (!cert) return { ok: false, error: "This computer isn't paired. Pair it again from its settings." };
    const origin = `https://${bracketHost(host)}:${port}`;
    // subdir ensured server-side so explorer lands somewhere real
    const subDir = panelId ? `files/${panelFilesDirName(panelId)}` : "";

    // a folder already open for this computer opens another window on it:
    // remounting would cut off a copy still running in the first window
    const open = active.get(computerId);
    if (open?.relay && (open.mount || process.platform === "linux") && open.host === host && open.port === port && open.cert === cert && open.mainToken === mainToken) {
        const error = (subDir ? await makeSubDir(origin, cert, open.davUser, open.davPass, subDir) : null) ?? (await showFolder(open, subDir));
        return error ? { ok: false, error } : { ok: true };
    }

    await closeRemoteFolder(computerId);

    let session: { user: string; pass: string };
    try {
        const res = await pinnedRequest(`${origin}/dav/session`, cert, {
            method: "POST",
            headers: { Authorization: `Bearer ${mainToken}` },
            body: JSON.stringify({ idleMs: IDLE_MS }),
            timeoutMs: 20_000,
        });
        if (!res.ok) return { ok: false, error: `The computer refused a file session (HTTP ${res.status}).` };
        session = JSON.parse(res.body.toString("utf8")) as { user: string; pass: string };
        if (!session?.user || !session?.pass) return { ok: false, error: "The computer answered with an unreadable file session." };
    } catch (err: any) {
        return { ok: false, error: `The computer can't be reached: ${err?.message ?? err}` };
    }

    const rec: ActiveSession = {
        computerId,
        host,
        port,
        cert,
        mainToken,
        davUser: session.user,
        davPass: session.pass,
        mount: "",
        relay: null,
        timer: null,
        seen: false,
        misses: 0,
        deadline: Date.now() + GRACE_MS,
    };

    const fail = async (error: string) => {
        await closeSession(rec);
        return { ok: false, error };
    };

    const madeSubDir = subDir ? await makeSubDir(origin, cert, session.user, session.pass, subDir) : null;
    if (madeSubDir) return await fail(madeSubDir);

    try {
        // linux file managers get a credential-free URL and the relay checks
        // the socket owner; macOS/Windows mount with the session credential
        active.set(computerId, rec);
        rec.relay = await startDavRelay({
            upstream: origin,
            cert,
            user: session.user,
            pass: session.pass,
            clientAuth: process.platform === "linux" ? "peer" : process.platform === "win32" ? "path" : "basic",
            idleMs: IDLE_MS,
            onIdle: () => void closeSession(rec),
        });

        if (process.platform === "win32") {
            // the relay's secret path in child env, never argv: argv is
            // world-readable via WMI/Task Manager
            const plan = buildWindowsMountCommand(windowsDavRoot(rec.relay.port, rec.relay.prefix));
            let out: { stdout: string; stderr: string };
            try {
                out = await execAsync("powershell.exe", plan.args, 60_000, undefined, plan.env);
            } catch (err: any) {
                const said = powershellErrorLine(err?.stderr ?? "") || (err?.message ?? String(err));
                return await fail(`Windows couldn't map the folder as a drive: ${said}`);
            }
            const drive = /([A-Z]:)/i.exec(out.stdout)?.[1]?.toUpperCase();
            if (!drive) {
                logger.warn("[RemoteFolder] mount output:", out.stdout);
                return await fail("Windows mounted the folder but didn't say which drive it used.");
            }
            rec.mount = drive;
        } else if (process.platform === "darwin") {
            const safeId = computerId.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 32) || "remote";
            const mountPoint = `/Volumes/Paperboard-${safeId}`;
            fs.mkdirSync(mountPoint, { recursive: true });
            // credential in a 0600 temp file, never argv/URL (both leak
            // into ps output)
            const scriptPath = macMountScriptPath();
            fs.writeFileSync(scriptPath, buildMacMountScript(session.user, session.pass, "127.0.0.1", rec.relay.port), {
                mode: 0o600,
            });
            try {
                await execAsync("osascript", [scriptPath], 60_000);
            } finally {
                try {
                    fs.unlinkSync(scriptPath);
                } catch (err) {
                    logger.warn(`[RemoteFolder] couldn't remove the mount script ${scriptPath}, which holds this session's password:`, err);
                }
            }
            rec.mount = mountPoint;
        }

        const shown = await showFolder(rec, subDir);
        if (shown) return await fail(shown);
        // linux: no window API to watch, so the relay's own idle timer ends it
        if (process.platform === "win32") startWatcher(rec, () => windowsHasWindow(rec.mount));
        else if (process.platform === "darwin") startWatcher(rec, () => macHasWindow(rec.mount));
        return { ok: true };
    } catch (err: any) {
        logger.warn("[RemoteFolder] open failed:", err?.message ?? err);
        return await fail(`The folder couldn't be mounted: ${err?.message ?? err}`);
    }
}
