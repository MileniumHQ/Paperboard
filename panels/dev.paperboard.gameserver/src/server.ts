import { createSignal } from "solid-js";
import { fileApi, config, packageApi, terminalApi } from "paperapi";
import type { PaperConsoleEntry, PaperBadgeVariant } from "paperui";
import { getRequiredJavaVersion, type ServerSoftwareType } from "./software";
import { SOFTWARE_NAMES } from "./Setup";

export type ServerStatus =
    | "offline"
    | "starting"
    | "online"
    | "stopping"
    | "restarting";

export const PTY_ID = "mc-server-pty";

export function stripAnsi(str: string): string {
    return str
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
        .replace(/\r/g, "")
        .trimEnd();
}

export function parseProperties(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
            continue;
        }
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            val = val.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16)),
            );
            result[key] = val;
        }
    }
    return result;
}

export async function getLocalNetworkIP(): Promise<string> {
    return new Promise((resolve) => {
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel("");
            pc.createOffer().then((offer) => pc.setLocalDescription(offer));
            let resolved = false;
            pc.onicecandidate = (ice) => {
                if (!ice || !ice.candidate || !ice.candidate.candidate) {
                    if (!resolved) {
                        resolved = true;
                        resolve("127.0.0.1");
                    }
                    return;
                }
                const candidate = ice.candidate.candidate;
                const match = candidate.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/);
                if (match && match[0] && !match[0].startsWith("127.")) {
                    resolved = true;
                    try {
                        pc.close();
                    } catch {}
                    resolve(match[0]);
                }
            };
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try {
                        pc.close();
                    } catch {}
                    resolve("127.0.0.1");
                }
            }, 1200);
        } catch {
            resolve("127.0.0.1");
        }
    });
}

export function parseLogLine(rawLine: string): PaperConsoleEntry {
    const clean = stripAnsi(rawLine);
    const upper = clean.toUpperCase();

    if (
        upper.includes("/ERROR") ||
        upper.includes("] ERROR") ||
        upper.includes("EXCEPTION")
    ) {
        return { type: "error", content: clean };
    }
    if (
        upper.includes("/WARN") ||
        upper.includes("] WARN") ||
        upper.includes("WARNING")
    ) {
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

export function parseChatMessage(rawLine: string): ChatMessage | null {
    const clean = stripAnsi(rawLine)
        .replace(/^[^[]*\[/, "[")
        .trim();
    if (!clean) return null;

    // Match [HH:MM:SS INFO]: ... or [HH:MM:SS] [Async Chat Thread - #0/INFO]: ... or [HH:MM:SS] [Server thread/INFO]: ...
    const logMatch = clean.match(
        /^\[(\d{2}:\d{2}:\d{2})(?:\]|\s+INFO\]?|\]\s*\[[^\]]*INFO[^\]]*\]):\s*(?:\[Not Secure\]\s*)?(.*)$/i,
    );
    if (!logMatch) return null;

    const time = logMatch[1];
    let text = logMatch[2].trim();
    if (!text) return null;

    if (text.startsWith("[Not Secure]")) {
        text = text.replace(/^\[Not Secure\]\s*/, "").trim();
    }

    // 1. Player chat message: <PlayerName> message or Server broadcast: [Server] message
    const isPlayerChat = /^<[a-zA-Z0-9_]{1,16}>\s+.+/i.test(text);
    const isServerSay = /^\[Server(?::\s*[^\]]+)?\]\s+.+/i.test(text);

    // 2. Player joins: PlayerName joined the game
    const isJoin = /^[a-zA-Z0-9_]{1,16}\s+joined the game$/i.test(text);

    // 3. Player leaves: PlayerName left the game
    const isLeave = /^[a-zA-Z0-9_]{1,16}\s+left the game$/i.test(text);

    if (isPlayerChat || isServerSay || isJoin || isLeave) {
        return {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text,
            timestamp: time,
        };
    }

    return null;
}

// Global server state signals
export const [serverStatus, setServerStatus] =
    createSignal<ServerStatus>("offline");
export const [serverEntries, setServerEntries] = createSignal<
    PaperConsoleEntry[]
>([]);
export const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
export const [localIp, setLocalIp] = createSignal("127.0.0.1");
export const [serverPort, setServerPort] = createSignal("25565");
export const [serverMotd, setServerMotd] = createSignal("A Minecraft Server");
export const [serverSoftware, setServerSoftware] =
    createSignal<ServerSoftwareType>("paper");
export const [serverVersion, setServerVersion] = createSignal("1.21.4");

let isRestarting = false;
let lineBuffer = "";
let isInitialized = false;
let stopTimeout: ReturnType<typeof setTimeout> | null = null;

export async function loadServerConfig() {
    try {
        const saved = await config.get<any>();
        if (saved?.software) setServerSoftware(saved.software);
        if (saved?.version) setServerVersion(saved.version);

        const ip = await getLocalNetworkIP();
        setLocalIp(ip);

        const properties = await fileApi.read("server.properties");
        if (properties) {
            const props = parseProperties(properties);
            const rawPort = props["server-port"];
            if (rawPort && rawPort !== "0" && !isNaN(Number(rawPort))) {
                setServerPort(rawPort);
            } else {
                setServerPort("25565");
            }

            const rawMotd = props["motd"];
            if (rawMotd) {
                const cleanMotd = rawMotd.replace(/§[0-9a-fk-or]/gi, "").trim();
                if (cleanMotd) {
                    setServerMotd(cleanMotd);
                }
            }
        }
    } catch (err) {
        console.error("[Server] Error loading server config:", err);
    }
}

export function initServerListeners() {
    if (isInitialized) return;
    isInitialized = true;

    terminalApi.onData(PTY_ID, (chunk: string) => {
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
            const clean = stripAnsi(line);
            if (!clean.trim()) continue;

            const portLogMatch = clean.match(
                /Starting (?:Minecraft )?server on .*:(\d+)/i,
            );
            if (portLogMatch && portLogMatch[1] && portLogMatch[1] !== "0") {
                setServerPort(portLogMatch[1]);
            }

            if (
                clean.includes("Done (") ||
                clean.includes("Done in") ||
                clean.includes('For help, type "help"') ||
                clean.includes("Started server")
            ) {
                setStatusOnline();
            } else if (
                clean.includes("Stopping server") ||
                clean.includes("Saving players")
            ) {
                setServerStatus("stopping");
            }

            const chat = parseChatMessage(line);
            if (chat) {
                setChatMessages((prev) => [...prev, chat]);
            }

            setServerEntries((prev) => [...prev, parseLogLine(line)]);
        }
    });

    terminalApi.onExit(PTY_ID, () => {
        if (stopTimeout) {
            clearTimeout(stopTimeout);
            stopTimeout = null;
        }

        if (lineBuffer.trim()) {
            const lastChat = parseChatMessage(lineBuffer);
            if (lastChat) {
                setChatMessages((prev) => [...prev, lastChat]);
            }
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
}

function setStatusOnline() {
    setServerStatus("online");
    loadServerConfig();
}

async function startServerProcess() {
    try {
        await loadServerConfig();

        const javaPkg = getRequiredJavaVersion(serverVersion());
        const javaPath = await packageApi.getPath(javaPkg);
        const serverDir = await fileApi.getPath("");
        const isWin =
            typeof navigator !== "undefined" &&
            navigator.platform?.toLowerCase().includes("win");
        const javaBin = `${javaPath}/bin/${isWin ? "java.exe" : "java"}`;

        setServerStatus("starting");
        setServerEntries((prev) => [
            ...prev,
            {
                type: "info",
                content: `[Server] Starting ${SOFTWARE_NAMES[serverSoftware()]} ${serverVersion()}...`,
            },
        ]);

        terminalApi.create(PTY_ID, {
            cwd: serverDir,
            env: {
                JAVA_HOME: javaPath,
            },
        });

        setTimeout(() => {
            if (serverSoftware() === "neoforge") {
                const runScript = isWin
                    ? "run.bat nogui\n"
                    : "exec ./run.sh nogui\n";
                terminalApi.write(PTY_ID, runScript);
            } else {
                const execPrefix = isWin ? "" : "exec ";
                terminalApi.write(
                    PTY_ID,
                    `${execPrefix}"${javaBin}" -jar server.jar nogui\n`,
                );
            }
        }, 100);
    } catch (err: any) {
        console.error("[Server] Failed to start server:", err);
        setServerStatus("offline");
        setServerEntries((prev) => [
            ...prev,
            {
                type: "error",
                content: `[Server] Failed to launch: ${err?.message || err}`,
            },
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
        terminalApi.destroy(PTY_ID);
        setServerStatus("offline");
        setServerEntries((prev) => [
            ...prev,
            { type: "warn", content: "[Server] Process killed by user." },
        ]);
    } else if (curr === "online") {
        setServerStatus("stopping");
        setServerEntries((prev) => [
            ...prev,
            { type: "command", content: "stop" },
        ]);
        terminalApi.write(PTY_ID, "stop\n");

        if (!stopTimeout) {
            stopTimeout = setTimeout(() => {
                terminalApi.destroy(PTY_ID);
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
    terminalApi.write(PTY_ID, "stop\n");

    if (!stopTimeout) {
        stopTimeout = setTimeout(() => {
            terminalApi.destroy(PTY_ID);
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
        terminalApi.write(PTY_ID, `${rawCmd}\n`);
    } else {
        setServerEntries((prev) => [
            ...prev,
            {
                type: "error",
                content: "Cannot execute command: server is offline.",
            },
        ]);
    }
}

export function sendChatMessage(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed) return;

    if (serverStatus() === "online" || serverStatus() === "starting") {
        terminalApi.write(PTY_ID, `say ${trimmed}\n`);
    } else {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        setChatMessages((prev) => [
            ...prev,
            {
                id: `chat-${Date.now()}`,
                text: "Cannot send message: server is offline.",
                timestamp: timeStr,
            },
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
