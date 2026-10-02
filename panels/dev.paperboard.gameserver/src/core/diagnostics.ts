
export interface ServerIssueAction {
    label: string;
    variant?: "danger" | "warning" | "brand" | "primary";
    icon?: string;
    actionKey?: string;
    action?: () => void | Promise<void>;
}

export interface ServerIssue {
    id: string;
    title: string;
    description: string;
    variant?: "danger" | "warning" | "brand";
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
            variant: "danger",
            actions: [
                {
                    label: "Kill Process & Retry",
                    variant: "danger",
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
            variant: "danger",
            actions: [
                {
                    label: "Kill Old Instance & Start",
                    variant: "danger",
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
// The processes listening on a TCP port, as an argv (never a shell line).
// The port is asserted numeric before it reaches here (assertPort).
export function listeningPidsCommand(
    port: string,
    isWin: boolean,
): { command: string; args: string[] } {
    if (isWin) {
        return {
            command: "powershell.exe",
            args: [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
            ],
        };
    }
    return { command: "lsof", args: ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"] };
}

// one pid per line; anything else (headers, blank lines, the System
// Idle "0" Windows reports for some sockets) is not a process to kill
export function parseListeningPids(output: string): number[] {
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!/^\d+$/.test(trimmed)) continue;
        const pid = Number(trimmed);
        if (pid > 0) pids.add(pid);
    }
    return [...pids];
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
