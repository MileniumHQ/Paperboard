// Mount credential hygiene for remote folders: DAV session passwords must never appear in spawn argv, where
// any process on the box can read them (WMI/Task Manager/ps).
//
// Windows maps with `net use` and no credential: the relay serves only a
// secret path, passed to PowerShell in a child-only env var, so argv
// carries a static script. macOS mounts with mount_webdav, which reads the
// credential from an open file descriptor. Linux opens a credential-free
// loopback URL served by the DAV relay (davRelay.ts), which adds the auth itself.
// No Electron imports: tests mount the real relay with these.
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

// platforms with a credential-safe way to open a remote folder
export function remoteFolderSupported(platform: NodeJS.Platform): boolean {
    return platform === "win32" || platform === "darwin" || platform === "linux";
}

export interface WindowsMountPlan {
    args: string[];
    env: Record<string, string>;
}

// The drive Windows maps for a relay in path mode: its WebDAV client's UNC
// form, \\host@port\path. The prefix is the relay's secret segment.
export function windowsDavRoot(port: number, prefix: string): string {
    if (!/^\/[0-9a-f]+$/.test(prefix)) throw new Error("a Windows mount needs the relay's secret path");
    return `\\\\127.0.0.1@${port}\\${prefix.slice(1)}\\dav`;
}

// The root, which holds the relay's secret, travels in the child's env only:
// argv is readable by every local account (WMI, Task Manager).
//
// Windows' WebDAV client (the WebClient service) starts on demand by an ETW
// trigger that ordinary users may fire, not by Start-Service, which needs an
// administrator; it's fired the way Windows itself does before mapping.
// `net use` maps WebDAV where New-PSDrive -Persist refuses an http root and
// fails with a credential, and /persistent:no drops the drive at sign-out,
// since the relay's port is gone by then. Any failure stops the script, so
// no drive letter is printed for a drive that never mapped (Explorer, sent
// to one, opened Documents).
export function buildWindowsMountCommand(root: string): WindowsMountPlan {
    const script = [
        "$ErrorActionPreference = 'Stop'",
        "$root = $env:PB_DAV_ROOT",
        "if ((Get-Service WebClient).Status -ne 'Running') {",
        "$trigger = New-Object System.Diagnostics.Eventing.EventProvider([guid]'22b6d684-fa63-4578-87c9-effcbe6643c7')",
        "[void]$trigger.WriteMessageEvent('')",
        "$trigger.Dispose()",
        "$deadline = (Get-Date).AddSeconds(15)",
        "while ((Get-Service WebClient).Status -ne 'Running') { if ((Get-Date) -gt $deadline) { Write-Error 'The WebClient service, which Windows opens WebDAV folders with, did not start. Check that it is not disabled in Services.'; exit 1 }; Start-Sleep -Milliseconds 200 }",
        "}",
        "$letter = ([char[]](68..90) | Where-Object { -not (Test-Path ($_ + ':')) } | Select-Object -First 1)",
        "if (-not $letter) { Write-Error 'Every drive letter is in use.'; exit 1 }",
        "$said = & net.exe use ($letter + ':') $root /persistent:no 2>&1",
        "if ($LASTEXITCODE -ne 0) { Write-Error (($said | Where-Object { ([string]$_).Trim() }) -join ' '); exit 1 }",
        "Write-Output ($letter + ':')",
    ].join("; ").replace(/\{; /g, "{ ").replace(/; \}/g, " }");
    return {
        args: ["-NoProfile", "-NonInteractive", "-Command", script],
        env: { PB_DAV_ROOT: root },
    };
}

// the first line of a PowerShell error, without colour codes or the
// "Cmdlet :" prefix, so a failed mount can say what Windows said
export function powershellErrorLine(stderr: string): string {
    const plain = stderr.replace(/\x1b\[[0-9;]*m/g, "");
    const line = plain.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
    return line.replace(/^[A-Za-z-]+\s*:\s*/, "");
}

// macOS mounts with mount_webdav, not Finder's `mount volume` (NetFS): NetFS
// asks the user "Unsecured Connection: send your name and password in a way
// that is insecure?" for any credential over http, even to 127.0.0.1, and
// waits on that dialog. mount_webdav with -S shows no UI and fails instead,
// and -a reads the credential from an open file, so it is in neither argv
// nor the mount table (which every local account can list).
const MAC_CREDENTIAL_FD = 3;

export function buildMacMountArgs(port: number, mountPoint: string): string[] {
    return ["-S", "-a", String(MAC_CREDENTIAL_FD), "-v", "Paperboard", `http://127.0.0.1:${port}/dav`, mountPoint];
}

// The record mount_webdav -a reads (webdavfs readCredentialsFromFile): a
// big-endian u32 length and the bytes of the user, password, proxy user and
// proxy password, then an empty certificate chain. It seeks to the start, so
// it must be a file, not a pipe.
export function macMountCredentials(user: string, pass: string): Buffer {
    const fields = [user, pass, "", ""].map((text) => Buffer.from(text, "utf8"));
    // webdavfs refuses a field of WEBDAV_MAX_USERNAME_LEN (256) bytes or more
    for (const field of fields) if (field.length >= 256) throw new Error("A mount credential is too long for macOS's WebDAV client");
    const parts: Buffer[] = [];
    for (const field of [...fields, Buffer.alloc(0)]) {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(field.length);
        parts.push(length, field);
    }
    return Buffer.concat(parts);
}

// what a failed mount_webdav exit says: it exits with the errno of the failure
function macMountFailure(code: number | null, signal: NodeJS.Signals | null): string {
    if (code === 80) return "the computer refused this folder session's password";
    if (code === null) return `mount_webdav was stopped (${signal ?? "no exit code"})`;
    return `mount_webdav exited with error ${code}`;
}

// The credential reaches mount_webdav as an open file that is already
// unlinked: no path names it, and nothing is left on disk if this process dies.
// Async: the relay that mount_webdav talks to is served by this process.
export async function mountMacFolder(user: string, pass: string, relayPort: number, mountPoint: string): Promise<void> {
    const credentials = macMountCredentials(user, pass);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperboard-mount-"));
    const file = path.join(dir, "credential");
    let fd: number;
    try {
        // a file already there is never written through
        await fs.promises.writeFile(file, credentials, { mode: 0o600, flag: "wx" });
        fd = fs.openSync(file, "r");
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
    let child: ReturnType<typeof spawn>;
    try {
        const stdio: ("ignore" | "pipe" | number)[] = ["ignore", "ignore", "pipe"];
        stdio[MAC_CREDENTIAL_FD] = fd;
        child = spawn("/sbin/mount_webdav", buildMacMountArgs(relayPort, mountPoint), { stdio, timeout: 60_000 });
    } finally {
        fs.closeSync(fd);
    }
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
    });
    if (code !== 0) throw new Error(`${macMountFailure(code, signal)}${stderr.trim() ? ` (${stderr.trim()})` : ""}`);
}

// Each open Finder window's folder, one per line; no window is no line.
// `get` makes the list itself: a window of `every Finder window` unread is a
// reference that won't become an alias, and every window would be skipped.
// A window with no folder (Recents, a search) is skipped.
const FINDER_WINDOWS = [
    'set out to ""',
    'tell application "Finder"',
    "repeat with w in (get every Finder window)",
    "try",
    "set out to out & (POSIX path of (target of w as alias)) & linefeed",
    "end try",
    "end repeat",
    "end tell",
    "return out",
];

// whether a Finder window shows the mounted folder or a folder in it
export async function macFolderHasWindow(mountPoint: string): Promise<boolean> {
    const { stdout } = await promisify(execFile)("osascript", FINDER_WINDOWS.flatMap((line) => ["-e", line]), { timeout: 15_000 });
    // Finder's paths end in "/": …/paperboard-folder-ab/ is in that folder, not in …/paperboard-folder-abc
    return stdout.split(/\r?\n/).some((line) => line.startsWith(`${mountPoint}/`));
}
