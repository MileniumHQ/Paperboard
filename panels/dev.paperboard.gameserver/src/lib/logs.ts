import type { PaperConsoleEntry } from "@mileniumhq/paperui";
import stripAnsi from "strip-ansi";
import type { ChatMessage } from "../core/state";

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

export function chatId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function parseChatMessage(rawLine: string): ChatMessage | null {
    const clean = stripAnsi(rawLine).replace(/^[^[]*\[/, "[").trim();
    if (!clean) return null;

    // Forge and NeoForge add the logger after the thread/level bracket:
    // "[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> hi"
    const logMatch = clean.match(
        /^\[(\d{2}:\d{2}:\d{2})(?:\]|\s+INFO\]?|\]\s*\[[^\]]*INFO[^\]]*\](?:\s*\[[^\]]*\])?):\s*(?:\[Not Secure\]\s*)?(.*)$/i,
    );
    if (!logMatch) return null;

    const time = logMatch[1];
    // 26.3 prefixes system messages in the console with "System chat: "
    let text = logMatch[2]
        .trim()
        .replace(/^System chat:\s*/, "")
        .replace(/^\[Not Secure\]\s*/, "")
        .trim();
    if (!text) return null;

    const playerChatMatch = text.match(/^<([a-zA-Z0-9_]{1,16})>\s+(.+)$/);
    if (playerChatMatch) {
        return { id: chatId(), sender: playerChatMatch[1], content: playerChatMatch[2].trim(), text, timestamp: time };
    }

    const serverMatch = text.match(/^\[Server(?::\s*[^\]]+)?\]\s+(.+)$/i);
    if (serverMatch) return { id: chatId(), event: "server", content: serverMatch[1], text, timestamp: time };

    const presenceMatch = text.match(/^([a-zA-Z0-9_]{1,16})\s+(joined|left) the game$/i);
    if (presenceMatch) {
        return { id: chatId(), event: presenceMatch[2].toLowerCase() === "joined" ? "join" : "leave", sender: presenceMatch[1], text, timestamp: time };
    }
    return null;
}
