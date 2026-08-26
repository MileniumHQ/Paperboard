import { createSignal } from "solid-js";
import { files as fileApi, terminal as terminalApi, system } from "@paperboard-dev/paperapi";
import { serverPort, startServer } from "./server";

export interface ServerIssueAction {
    label: string;
    variant?: "red" | "yellow" | "brand" | "blue";
    icon?: string;
    action: () => void | Promise<void>;
}

export interface ServerIssue {
    id: string;
    title: string;
    description: string;
    variant?: "red" | "yellow" | "brand";
    actions: ServerIssueAction[];
}

export const [activeIssue, setActiveIssue] = createSignal<ServerIssue | null>(null);

export function clearActiveIssue() {
    setActiveIssue(null);
}

// Terminates conflicting processes bound to the server port
export async function killConflictingProcess(port: string = serverPort()) {
    try {
        const killCmd = `lsof -ti :${port} | xargs kill -9 2>/dev/null || killall -9 java 2>/dev/null || true`;
        await terminalApi.create("kill-port-pty", { cols: 80, rows: 24 });
        terminalApi.write("kill-port-pty", `${killCmd}\nexit\n`);
        setTimeout(() => terminalApi.destroy("kill-port-pty"), 1000);
    } catch (err) {
        console.error(`[Diagnostics] Failed to kill conflicting process on port ${port} (kill -9):`, err);
    }
}

// Resets world dimension folders to fix corrupted chunk generation
export async function resetWorldFiles() {
    try {
        const serverDir = await fileApi.getPath("");
        // OS of the computer this panel targets — not the shell's active one.
        const targetOs = (await system.getInfo()).os;
        const isWin =
            targetOs === "windows" ||
            serverDir.includes("\\") ||
            serverDir.includes(":");
        const cleanCmd = isWin
            ? `rmdir /s /q world world_nether world_the_end 2>nul || exit 0`
            : `rm -rf world world_nether world_the_end`;

        await terminalApi.create("clean-world-pty", { cwd: serverDir, cols: 80, rows: 24 });
        terminalApi.write("clean-world-pty", `${cleanCmd}\nexit\n`);
        setTimeout(() => terminalApi.destroy("clean-world-pty"), 1000);
    } catch (err) {
        console.error("[Diagnostics] Failed to reset world files (rm -rf world directories):", err);
    }
}

export interface DiagnosticRule {
    id: string;
    pattern: RegExp;
    create: () => ServerIssue;
}

// Rules for detecting actionable runtime errors in server logs
export const DIAGNOSTIC_RULES: DiagnosticRule[] = [
    {
        id: "port-conflict",
        pattern: /FAILED TO BIND TO PORT|Address already in use|bind\(..\) failed/i,
        create: () => ({
            id: "port-conflict",
            title: "Port Conflict Detected",
            description: `A process is already using port ${serverPort()}. You can kill the conflicting process to free the port, or change which port the server is running on in Options.`,
            variant: "red",
            actions: [
                {
                    label: "Kill Process & Retry",
                    variant: "red",
                    icon: "skull",
                    action: async () => {
                        await killConflictingProcess(serverPort());
                        clearActiveIssue();
                        setTimeout(() => startServer(), 600);
                    },
                },
            ],
        }),
    },
    {
        id: "corrupt-world",
        pattern: /Overworld settings missing|Unable to read or access the world gen settings file|Failed to load datapacks, can't proceed with server load/i,
        create: () => ({
            id: "corrupt-world",
            title: "Corrupted World Data",
            description: "The world files appear to be incomplete or corrupted from an interrupted startup. Would you like to reset the world files to generate a fresh new world?",
            variant: "yellow",
            actions: [
                {
                    label: "Reset World & Start",
                    variant: "red",
                    icon: "restart_alt",
                    action: async () => {
                        await resetWorldFiles();
                        clearActiveIssue();
                        setTimeout(() => startServer(), 500);
                    },
                },
            ],
        }),
    },
    {
        id: "eula-agreement",
        pattern: /You need to agree to the EULA in order to run the server/i,
        create: () => ({
            id: "eula-agreement",
            title: "EULA Agreement Required",
            description: "Mojang requires accepting the Minecraft End User License Agreement (EULA) before launching the server.",
            variant: "brand",
            actions: [
                {
                    label: "Accept EULA & Launch",
                    variant: "brand",
                    icon: "check",
                    action: async () => {
                        await fileApi.write("eula.txt", "eula=true\n");
                        clearActiveIssue();
                        setTimeout(() => startServer(), 400);
                    },
                },
            ],
        }),
    },
    {
        id: "world-locked",
        pattern: /DirectoryLock\$LockException|session\.lock.*already locked/i,
        create: () => ({
            id: "world-locked",
            title: "World Already Locked",
            description: `Another Minecraft server instance is already running this world (its session.lock is held). This usually happens after Paperboard restarts while the old server process kept living in the background. Kill it to free the world.`,
            variant: "red",
            actions: [
                {
                    label: "Kill Old Instance & Start",
                    variant: "red",
                    icon: "skull",
                    action: async () => {
                        await killConflictingProcess(serverPort());
                        clearActiveIssue();
                        setTimeout(() => startServer(), 600);
                    },
                },
            ],
        }),
    },
    {
        id: "out-of-memory",
        pattern: /java\.lang\.OutOfMemoryError|Java heap space/i,
        create: () => ({
            id: "out-of-memory",
            title: "Out Of Memory",
            description: "The Minecraft server ran out of allocated memory. Consider increasing heap memory or reducing heavy mods/chunks.",
            variant: "red",
            actions: [],
        }),
    },
];

// Scans individual log line for known issue signatures
export function checkLogForIssues(cleanLine: string) {
    if (!cleanLine.trim()) return;
    for (const rule of DIAGNOSTIC_RULES) {
        if (rule.pattern.test(cleanLine)) {
            setActiveIssue(rule.create());
            break;
        }
    }
}
