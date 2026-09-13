import { isWindowsTarget } from "../lib/platform";
import { getWorldDirsToDelete } from "./worlds";
import { trashRemovePathsWith, runPtyCommandWith, type TrashRemoveDeps } from "./trash";

export interface ServerIssueAction {
    label: string;
    variant?: "red" | "yellow" | "brand" | "blue";
    icon?: string;
    actionKey?: string;
    action?: () => void | Promise<void>;
}

export interface ServerIssue {
    id: string;
    title: string;
    description: string;
    variant?: "red" | "yellow" | "brand";
    actions: ServerIssueAction[];
}

// null when no issue matches
export function detectServerIssue(
    cleanLine: string,
    serverPort: string,
): ServerIssue | null {
    if (!cleanLine.trim()) return null;

    if (/FAILED TO BIND TO PORT|Address already in use|bind\(..\) failed/i.test(cleanLine)) {
        return {
            id: "port-conflict",
            title: "Port Conflict Detected",
            description: `A process is already using port ${serverPort}. You can kill the conflicting process or change ports in Options.`,
            variant: "red",
            actions: [
                {
                    label: "Kill Process & Retry",
                    variant: "red",
                    icon: "skull",
                    actionKey: "killPortAndRetry",
                },
            ],
        };
    }
    if (/DirectoryLock\$LockException|session\.lock.*already locked/i.test(cleanLine)) {
        return {
            id: "world-locked",
            title: "World Already Locked",
            description:
                "Another Minecraft server instance is already running this world. Kill it to free the world.",
            variant: "red",
            actions: [
                {
                    label: "Kill Old Instance & Start",
                    variant: "red",
                    icon: "skull",
                    actionKey: "killPortAndRetry",
                },
            ],
        };
    }
    if (/You need to agree to the EULA in order to run the server/i.test(cleanLine)) {
        return {
            id: "eula-agreement",
            title: "EULA Agreement Required",
            description:
                "Mojang requires accepting the Minecraft EULA before launching the server.",
            variant: "brand",
            actions: [
                {
                    label: "Accept EULA & Launch",
                    variant: "brand",
                    icon: "check",
                    actionKey: "acceptEula",
                },
            ],
        };
    }
    return null;
}

export interface IssueCheckDeps {
    serverPort: string;
    setIssue: (issue: ServerIssue) => void;
}

export function checkLogForIssues(deps: IssueCheckDeps, cleanLine: string): void {
    const issue = detectServerIssue(cleanLine, deps.serverPort);
    if (issue) deps.setIssue(issue);
}
export function buildKillPortCommand(port: string, isWin: boolean): string {
    // the port is asserted numeric before it ever reaches this
    // interpolation (see assertPort): a UI-supplied string must never
    // become shell syntax
    if (isWin) {
        return `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"`;
    }
    return `lsof -ti :${port} | xargs -r kill -9 || true`;
}

// ports reach shell commands: numeric-only at the boundary, UI checks
// don't count. Throws instead of coercing — "8080;" is not 8080.
export function assertPort(port: unknown, what = "port"): string {
    const s = String(port ?? "").trim();
    if (!/^\d+$/.test(s)) {
        throw new Error(`Refusing unsafe ${what} value: ${JSON.stringify(port)}`);
    }
    const n = Number(s);
    if (n < 1 || n > 65535) {
        throw new Error(`Refusing out-of-range ${what} value: ${JSON.stringify(port)}`);
    }
    return String(n);
}

export interface ResetWorldDeps extends TrashRemoveDeps {}

// world reset deletes the live world dirs — trash first, then remove
// (see core/trash.ts), and for the server's actual level-name, never a
// hardcoded "world"
export async function resetWorldFilesWith(deps: ResetWorldDeps, levelName: string): Promise<void> {
    await trashRemovePathsWith(deps, getWorldDirsToDelete(levelName), "clean-world-pty");
}

// a kill-port pty differs from a trash pty only in cwd (it doesn't need
// the server dir — though the caller supplies it anyway via the OS probe)
export interface KillProcessDeps extends TrashRemoveDeps {}


export async function killConflictingProcessWith(
    deps: KillProcessDeps,
    port: string,
): Promise<void> {
    // last line of defense: even a service caller that forgot to validate
    // cannot interpolate shell syntax through here
    const safePort = assertPort(port);
    const serverDir = await deps.getServerDir();
    const targetOs = await deps.getTargetOs();
    const killCmd = buildKillPortCommand(safePort, isWindowsTarget(serverDir, targetOs));
    await deps.createPty("kill-port-pty", { cols: 80, rows: 24, cwd: serverDir });
    // completion is verified the same way a trash remove is: the pty runs
    // to exit. There is no success marker — `|| true` legitimately treats
    // "nothing bound to this port" as success — but a dead pty is no
    // longer reported as a completed kill.
    await runPtyCommandWith(deps, "kill-port-pty", killCmd);
}
