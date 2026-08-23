import { createSignal } from "solid-js";
import { fileApi, config, packageApi, processApi, computers } from "paperapi";
import type { PaperConsoleEntry, PaperBadgeVariant } from "paperui";
import stripAnsi from "strip-ansi";
import properties from "dot-properties";
import { getRequiredJavaVersion, type ServerSoftwareType } from "./software";
import { SOFTWARE_NAMES } from "./Setup";
import { checkLogForIssues, clearActiveIssue } from "./diagnostics";

export type ServerStatus =
    | "offline"
    | "starting"
    | "online"
    | "stopping"
    | "restarting";

export const SERVER_PROC_ID = "mc-server";

// Re-export stripAnsi for usage across the panel
export { stripAnsi };

// Parses Java .properties files using dot-properties library
export function parseProperties(content: string): Record<string, string> {
    return (properties.parse(content) || {}) as Record<string, string>;
}

export async function getLocalNetworkIP(): Promise<string> {
    try {
        const active = await computers.getActive();
        if (active?.host) return active.host;
    } catch {}
    return "127.0.0.1";
}

// Parses raw Minecraft console log lines into structured console entries
export function parseLogLine(rawLine: string): PaperConsoleEntry {
    const clean = stripAnsi(rawLine);
    const upper = clean.toUpperCase();

    if (upper.includes("/ERROR") || upper.includes("] ERROR") || upper.includes("EXCEPTION")) {
        return { type: "error", content: clean };
    }
    if (upper.includes("/WARN") || upper.includes("] WARN") || upper.includes("WARNING")) {
        return { type: "warn", content: clean };
    }
    if (upper.includes("/INFO") || upper.includes("] INFO")) {
        return { type: "info", content: clean };
    }
    return { type: "output", content: clean };
}

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: string;
}

// Extracts in-game player and server chat messages from log output
export function parseChatMessage(rawLine: string): ChatMessage | null {
    const clean = stripAnsi(rawLine).replace(/^[^[]*\[/, "[").trim();
    if (!clean) return null;

    const logMatch = clean.match(
        /^\[(\d{2}:\d{2}:\d{2})(?:\]|\s+INFO\]?|\]\s*\[[^\]]*INFO[^\]]*\]):\s*(?:\[Not Secure\]\s*)?(.*)$/i,
    );
    if (!logMatch) return null;

    const time = logMatch[1];
    let text = logMatch[2].trim().replace(/^\[Not Secure\]\s*/, "").trim();
    if (!text) return null;

    const isChat =
        /^<[a-zA-Z0-9_]{1,16}>\s+.+/i.test(text) ||
        /^\[Server(?::\s*[^\]]+)?\]\s+.+/i.test(text) ||
        /^[a-zA-Z0-9_]{1,16}\s+joined the game$/i.test(text) ||
        /^[a-zA-Z0-9_]{1,16}\s+left the game$/i.test(text);

    if (isChat) {
        return {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text,
            timestamp: time,
        };
    }
    return null;
}

// Server state signals
export const [serverStatus, setServerStatus] = createSignal<ServerStatus>("offline");
export const [serverEntries, setServerEntries] = createSignal<PaperConsoleEntry[]>([]);
export const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
export const [localIp, setLocalIp] = createSignal("127.0.0.1");
export const [serverPort, setServerPort] = createSignal("25565");
export const [serverMotd, setServerMotd] = createSignal("A Minecraft Server");
export const [serverSoftware, setServerSoftware] = createSignal<ServerSoftwareType>("paper");
export const [serverVersion, setServerVersion] = createSignal("1.21.4");

let isRestarting = false;
let lineBuffer = "";
let isInitialized = false;
let stopTimeout: ReturnType<typeof setTimeout> | null = null;
let serverProcessStarted = false;

// Loads server configuration and server.properties values
export async function loadServerConfig() {
    try {
        const saved = await config.get<any>();
        if (saved?.software) setServerSoftware(saved.software);
        if (saved?.version) setServerVersion(saved.version);

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
            if (chat) setChatMessages((prev) => [...prev, chat]);

            setServerEntries((prev) => [...prev, parseLogLine(line)]);
        }
    });

    processApi.onExit(SERVER_PROC_ID, () => {
        if (stopTimeout) {
            clearTimeout(stopTimeout);
            stopTimeout = null;
        }

        if (lineBuffer.trim()) {
            const lastChat = parseChatMessage(lineBuffer);
            if (lastChat) setChatMessages((prev) => [...prev, lastChat]);
            setServerEntries((prev) => [...prev, parseLogLine(lineBuffer)]);
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
    } catch {}
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
        const activeComp = await computers.getActive().catch(() => null);
        const isWin = activeComp?.os === "windows" || serverDir.includes("\\") || serverDir.includes(":");
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
            args: ["-jar", "server.jar", "nogui"],
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

    setServerEntries((prev) => [...prev, { type: "command", content: cmd }]);

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
