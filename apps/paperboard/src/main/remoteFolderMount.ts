// Mount credential hygiene for remote folders (pure builders, no side
// effects): DAV session passwords must never appear in spawn argv, where
// any process on the box can read them (WMI/Task Manager/ps).
//
// Windows maps with PowerShell New-PSDrive -Persist and a PSCredential
// built from child-only env vars — argv carries a static script plus a
// non-secret URL. macOS mounts through a 0600 temp osascript file that is
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

function singleQuoted(s: string): string {
    if (/[\r\n]/.test(s)) throw new Error("mount value contains a line break");
    return `'${s.replace(/'/g, "''")}'`;
}

function appleQuoted(s: string): string {
    if (/[\r\n]/.test(s)) throw new Error("mount value contains a line break");
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// passwordless argv: the credential travels in the child's env only
export function buildWindowsMountCommand(
    url: string,
    user: string,
    pass: string,
): WindowsMountPlan {
    const script = [
        "$u = $env:PB_DAV_USER",
        "$p = ConvertTo-SecureString $env:PB_DAV_PASS -AsPlainText -Force",
        "$c = New-Object System.Management.Automation.PSCredential($u, $p)",
        `$root = ${singleQuoted(url)}`,
        "$letter = ([char[]](68..90) | Where-Object { -not (Test-Path ($_ + ':')) } | Select-Object -First 1)",
        "if (-not $letter) { Write-Error 'no-drive-letter'; exit 1 }",
        "New-PSDrive -Name $letter -PSProvider FileSystem -Root $root -Credential $c -Persist -Scope Global | Out-Null",
        "Write-Output ($letter + ':')",
    ].join("; ");
    return {
        args: ["-NoProfile", "-NonInteractive", "-Command", script],
        env: { PB_DAV_USER: user, PB_DAV_PASS: pass },
    };
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
