import { isWindowsTarget } from "../lib/platform";

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

export function buildKillPortCommand(port: string): string {
    return `lsof -ti :${port} | xargs kill -9 2>/dev/null || killall -9 java 2>/dev/null || true`;
}

export function buildResetWorldCommand(isWin: boolean): string {
    return isWin
        ? `rmdir /s /q world world_nether world_the_end 2>nul || exit 0`
        : `rm -rf world world_nether world_the_end`;
}

export interface KillProcessDeps {
    createPty: (id: string, opts: { cols: number; rows: number; cwd?: string }) => unknown;
    writePty: (id: string, data: string) => void;
    scheduleDestroy: (id: string) => void;
}

export async function killConflictingProcessWith(
    deps: KillProcessDeps,
    port: string,
): Promise<void> {
    const killCmd = buildKillPortCommand(port);
    await deps.createPty("kill-port-pty", { cols: 80, rows: 24 });
    deps.writePty("kill-port-pty", `${killCmd}\nexit\n`);
    deps.scheduleDestroy("kill-port-pty");
}

export interface ResetWorldDeps extends KillProcessDeps {
    getServerDir: () => Promise<string>;
    getTargetOs: () => Promise<string>;
}

export async function resetWorldFilesWith(deps: ResetWorldDeps): Promise<void> {
    const serverDir = await deps.getServerDir();
    const targetOs = await deps.getTargetOs();
    const isWin = isWindowsTarget(serverDir, targetOs);
    const cleanCmd = buildResetWorldCommand(isWin);

    await deps.createPty("clean-world-pty", { cwd: serverDir, cols: 80, rows: 24 });
    deps.writePty("clean-world-pty", `${cleanCmd}\nexit\n`);
    deps.scheduleDestroy("clean-world-pty");
}
