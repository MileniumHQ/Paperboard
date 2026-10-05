import type { PaperConsoleEntry } from "@mileniumhq/paperui";
import stripAnsi from "strip-ansi";

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
    sender?: string;
    content?: string;
    text: string;
    timestamp: string;
}

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

    const playerChatMatch = text.match(/^<([a-zA-Z0-9_]{1,16})>\s+(.+)$/);
    if (playerChatMatch) {
        return {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sender: playerChatMatch[1],
            content: playerChatMatch[2].trim(),
            text,
            timestamp: time,
        };
    }

    const isSystemChat =
        /^\[Server(?::\s*[^\]]+)?\]\s+.+/i.test(text) ||
        /^[a-zA-Z0-9_]{1,16}\s+joined the game$/i.test(text) ||
        /^[a-zA-Z0-9_]{1,16}\s+left the game$/i.test(text);

    if (isSystemChat) {
        return {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text,
            timestamp: time,
        };
    }
    return null;
}
