import { createSignal } from "solid-js";
import { fileApi, config, packageApi, processApi, system } from "@paperboard-dev/paperapi";
import type { PaperConsoleEntry, PaperBadgeVariant } from "@paperboard-dev/paperui";
import stripAnsi from "strip-ansi";
import properties from "dot-properties";
import { getRequiredJavaVersion, SOFTWARE_NAMES, type ServerSoftwareType } from "./software";
import { checkLogForIssues, clearActiveIssue } from "./diagnostics";
import { parseChatMessage, parseLogLine } from "./logs";
import {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    handleStatResponse,
    onlinePlayerNames,
    playerStats,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerStats,
    restorePlayerStateFromLog,
    seenPlayerNames,
    setOnlinePlayerNames,
    trackPlayerActivity,
    type PlayerStatData,
} from "./players";

export type ServerStatus =
    | "offline"
    | "starting"
    | "online"
    | "stopping"
    | "restarting";

export const SERVER_PROC_ID = "mc-server";

// Re-export stripAnsi for usage across the panel
export { stripAnsi };

// Maximum number of console entries / chat messages kept in memory
const MAX_BUFFERED_ENTRIES = 1000;

function appendCapped<T>(prev: T[], entry: T): T[] {
    const next = [...prev, entry];
    return next.length > MAX_BUFFERED_ENTRIES
        ? next.slice(next.length - MAX_BUFFERED_ENTRIES)
        : next;
}

// Validates Minecraft player names (letters, digits, underscores, 1-16 chars)
export const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;

// Parses Java .properties files using dot-properties
export function parseProperties(content: string): Record<string, string> {
    return (properties.parse(content) || {}) as Record<string, string>;
}

// LAN IP of the targeted computer, same source as the Computer Info panel
export function getLocalNetworkIP(): Promise<string> {
    return system.getLocalIP();
}

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: string;
}

export const [serverStatus, setServerStatus] = createSignal<ServerStatus>("offline");
export const [serverEntries, setServerEntries] = createSignal<PaperConsoleEntry[]>([]);
export const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
export const [localIp, setLocalIp] = createSignal("127.0.0.1");
export const [serverPort, setServerPort] = createSignal("25565");
export const [serverMotd, setServerMotd] = createSignal("A Minecraft Server");
export const [serverSoftware, setServerSoftware] = createSignal<ServerSoftwareType>("paper");
export const [serverVersion, setServerVersion] = createSignal("1.21.4");
// Java heap in GB, applied as -Xmx/-Xms at launch
export const [ramAllocation, setRamAllocation] = createSignal(4);

export const MIN_RAM_GB = 1;
export const MAX_RAM_GB = 16;

// Merges a patch into the panel's persisted config object.
export async function updatePanelConfig(patch: Record<string, unknown>) {
    let current: Record<string, unknown> = {};
    try {
        const saved = await config.get<Record<string, unknown>>();
        if (saved && typeof saved === "object") current = saved;
    } catch (err) {
        console.error("[Server] Failed to read panel config before update:", err);
    }
    await config.set({ ...current, ...patch });
}

// Re-exported player tracking API so existing imports keep working
export {
    forgetPlayerData,
    getPlayerPlaytimeSeconds,
    onlinePlayerNames,
    playerStats,
    playerPlaytime,
    queryOnlinePlayers,
    queryPlayerStats,
    seenPlayerNames,
};
export type { PlayerStatData };

let isRestarting = false;
let lineBuffer = "";
let isInitialized = false;
let stopTimeout: ReturnType<typeof setTimeout> | null = null;

// Exit event may never arrive after force-kill; poll until gone and recover
function watchForceKill() {
    const startedAt = Date.now();
    const poll = setInterval(async () => {
        try {
            const stillRunning = await processApi.exists(SERVER_PROC_ID);
            if (!stillRunning || Date.now() - startedAt > 10000) {
                clearInterval(poll);
                isRestarting = false;
                if (stopTimeout) {
                    clearTimeout(stopTimeout);
                    stopTimeout = null;
                }
                setServerStatus("offline");
                setServerEntries((prev) => [
                    ...prev,
                    { type: "warn", content: "[Server] Process stopped." },
                ]);
            }
        } catch (err) {
            console.error("[Server] Failed to check server process existence during force-kill watch:", err);
            clearInterval(poll);
        }
    }, 500);
}
let serverProcessStarted = false;

// Loads server configuration and server.properties values
export async function loadServerConfig() {
    try {
        const saved = await config.get<any>();
        if (saved?.software) setServerSoftware(saved.software);
        if (saved?.version) setServerVersion(saved.version);
        if (
            typeof saved?.ramGB === "number" &&
            Number.isInteger(saved.ramGB) &&
            saved.ramGB >= MIN_RAM_GB &&
            saved.ramGB <= MAX_RAM_GB
        ) {
            setRamAllocation(saved.ramGB);
        }

        setLocalIp(await getLocalNetworkIP());

        const propertiesContent = await fileApi.read("server.properties");
        if (propertiesContent) {
            const props = parseProperties(propertiesContent);
            const rawPort = props["server-port"];
            if (rawPort && rawPort !== "0" && !isNaN(Number(rawPort))) {
                setServerPort(rawPort);
            }
            const rawMotd = props["motd"];
            if (rawMotd) {
                const cleanMotd = rawMotd.replace(/§[0-9a-fk-or]/gi, "").trim();
                if (cleanMotd) setServerMotd(cleanMotd);
            }
        }
    } catch (err) {
        console.error("[Server] Error loading server config:", err);
    }
}

// Subscribes to process output stream and detects server lifecycle events
export async function initServerListeners() {
    if (isInitialized) return;
    isInitialized = true;

    void restorePlayerStateFromLog();

    processApi.onData(SERVER_PROC_ID, (chunk: string) => {
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
            const clean = stripAnsi(line);
            if (!clean.trim()) continue;

            serverProcessStarted = true;

            const portMatch = clean.match(/Starting (?:Minecraft )?server on .*:(\d+)/i);
            if (portMatch?.[1] && portMatch[1] !== "0") setServerPort(portMatch[1]);

            trackPlayerActivity(clean);

            if (handleStatResponse(clean)) {
                continue;
            }

            checkLogForIssues(clean);

            if (
                clean.includes("Done (") ||
                clean.includes("Done in") ||
                clean.includes('For help, type "help"') ||
                clean.includes("Started server")
            ) {
                setStatusOnline();
            } else if (clean.includes("Stopping server") || clean.includes("Saving players")) {
                setServerStatus("stopping");
            }

            const chat = parseChatMessage(line);
            if (chat) setChatMessages((prev) => appendCapped(prev, chat));

            setServerEntries((prev) => appendCapped(prev, parseLogLine(line)));
        }
    });

    processApi.onExit(SERVER_PROC_ID, () => {
        setOnlinePlayerNames(new Set<string>());
        if (stopTimeout) {
            clearTimeout(stopTimeout);
            stopTimeout = null;
        }

        if (lineBuffer.trim()) {
            const lastChat = parseChatMessage(lineBuffer);
            if (lastChat) setChatMessages((prev) => appendCapped(prev, lastChat));
            setServerEntries((prev) => appendCapped(prev, parseLogLine(lineBuffer)));
            lineBuffer = "";
        }

        if (isRestarting) {
            isRestarting = false;
            setServerStatus("starting");
            setServerEntries((prev) => [
                ...prev,
                { type: "info", content: "[Server] Restarting instance..." },
            ]);
            startServerProcess();
        } else {
            setServerStatus("offline");
            setServerEntries((prev) => [
                ...prev,
                { type: "warn", content: "[Server] Process stopped." },
            ]);
        }
    });

    try {
        const isRunning = await processApi.exists(SERVER_PROC_ID);
        if (isRunning) {
            serverProcessStarted = true;
            setServerStatus("online");
            loadServerConfig();
        }
    } catch (err) {
        console.error("[Server] Failed to check whether the server process is already running:", err);
    }
}

function setStatusOnline() {
    setServerStatus("online");
    loadServerConfig();
}

// Spawns the Minecraft server process using installed Java runtime
async function startServerProcess() {
    try {
        serverProcessStarted = false;
        clearActiveIssue();
        await loadServerConfig();

        const javaPkg = getRequiredJavaVersion(serverVersion());
        const javaPath = await packageApi.getPath(javaPkg);
        const serverDir = await fileApi.getPath("");
        // OS of the computer this panel targets — not the shell's active one.
        const targetOs = (await system.getInfo()).os;
        const isWin = targetOs === "windows" || serverDir.includes("\\") || serverDir.includes(":");
        const javaBin = `${javaPath}/bin/${isWin ? "java.exe" : "java"}`;

        setServerStatus("starting");
        setChatMessages([]);
        setServerEntries([
            {
                type: "info",
                content: `[Server] Starting ${SOFTWARE_NAMES[serverSoftware()]} ${serverVersion()}...`,
            },
        ]);

        await processApi.start({
            id: SERVER_PROC_ID,
            command: javaBin,
            args: [
                `-Xmx${ramAllocation()}G`,
                `-Xms${ramAllocation()}G`,
                "-jar",
                "server.jar",
                "nogui",
            ],
            cwd: serverDir,
            env: { JAVA_HOME: javaPath },
        });
    } catch (err: any) {
        console.error("[Server] Failed to start server:", err);
        setServerStatus("offline");
        setServerEntries((prev) => [
            ...prev,
            { type: "error", content: `[Server] Failed to launch: ${err?.message || err}` },
        ]);
    }
}

export function startServer() {
    if (serverStatus() !== "offline") return;
    startServerProcess();
}

export function stopServer() {
    const curr = serverStatus();
    if (curr === "starting") {
        processApi.kill(SERVER_PROC_ID, "SIGKILL");
        setServerStatus("offline");
        setServerEntries((prev) => [
            ...prev,
            { type: "warn", content: "[Server] Process killed by user." },
        ]);
    } else if (curr === "online") {
        setServerStatus("stopping");
        setServerEntries((prev) => [...prev, { type: "command", content: "stop" }]);
        processApi.write(SERVER_PROC_ID, "stop\n");

        if (!stopTimeout) {
            stopTimeout = setTimeout(() => {
                processApi.kill(SERVER_PROC_ID, "SIGKILL");
                watchForceKill();
            }, 15000);
        }
    }
}

export function restartServer() {
    if (serverStatus() !== "online") return;
    isRestarting = true;
    setServerStatus("restarting");
    setServerEntries((prev) => [
        ...prev,
        { type: "command", content: "stop" },
        { type: "info", content: "[Server] Stopping for restart..." },
    ]);
    processApi.write(SERVER_PROC_ID, "stop\n");

    if (!stopTimeout) {
        stopTimeout = setTimeout(() => {
            processApi.kill(SERVER_PROC_ID, "SIGKILL");
            watchForceKill();
        }, 15000);
    }
}

export function sendServerCommand(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    if (trimmed === "clear") {
        setServerEntries([]);
        return;
    }

    setServerEntries((prev) => appendCapped(prev, { type: "command", content: cmd }));

    if (serverStatus() === "online" || serverStatus() === "starting") {
        const rawCmd = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
        processApi.write(SERVER_PROC_ID, `${rawCmd}\n`);
    } else {
        setServerEntries((prev) => [
            ...prev,
            { type: "error", content: "Cannot execute command: server is offline." },
        ]);
    }
}

export function sendChatMessage(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed) return;

    if (serverStatus() === "online" || serverStatus() === "starting") {
        processApi.write(SERVER_PROC_ID, `say ${trimmed}\n`);
    } else {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        setChatMessages((prev) => [
            ...prev,
            { id: `chat-${Date.now()}`, text: "Cannot send message: server is offline.", timestamp: timeStr },
        ]);
    }
}

export function getStatusBadge(status: ServerStatus): {
    label: string;
    variant: PaperBadgeVariant;
} {
    switch (status) {
        case "online":
            return { label: "Online", variant: "green" };
        case "starting":
            return { label: "Starting...", variant: "yellow" };
        case "stopping":
            return { label: "Stopping...", variant: "red" };
        case "restarting":
            return { label: "Restarting...", variant: "yellow" };
        case "offline":
        default:
            return { label: "Offline", variant: "monochrome" };
    }
}
