// Mount credential hygiene for remote folders (pure builders, no side
// effects): DAV session passwords must never appear in spawn argv, where
// any process on the box can read them (WMI/Task Manager/ps).
//
// Windows maps with `net use` and no credential: the relay serves only a
// secret path, passed to PowerShell in a child-only env var, so argv
// carries a static script. macOS mounts through a 0600 temp osascript file that is
// unlinked right after use. Linux opens a credential-free loopback URL
// served by the DAV relay (davRelay.ts), which adds the auth itself.
import * as os from "os";
import * as path from "path";

// platforms with a credential-safe way to open a remote folder
export function remoteFolderSupported(platform: NodeJS.Platform): boolean {
    return platform === "win32" || platform === "darwin" || platform === "linux";
}

export interface WindowsMountPlan {
    args: string[];
    env: Record<string, string>;
}

function appleQuoted(s: string): string {
    if (/[\r\n]/.test(s)) throw new Error("mount value contains a line break");
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

// AppleScript mount body: written to a 0600 temp file by the caller and
// unlinked after osascript exits — never an argv element
export function buildMacMountScript(
    user: string,
    pass: string,
    host: string,
    port: number,
): string {
    return `mount volume "http://${host}:${port}/dav" as user name "${appleQuoted(user)}" with password "${appleQuoted(pass)}"`;
}

// temp script path for the mount body (caller sets 0600 + unlinks)
export function macMountScriptPath(): string {
    return path.join(
        os.tmpdir(),
        `paperboard-mount-${process.pid}-${Date.now()}.scpt`,
    );
}
