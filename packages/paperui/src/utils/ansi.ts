import Anser from "anser";
import type { JSX } from "solid-js";

export interface AnsiSegment {
    text: string;
    style: JSX.CSSProperties;
}

export function cleanTerminalLine(rawLine: string): string {
    if (!rawLine) return "";
    // In terminal emulation, \r (carriage return) moves the cursor back to the start of the line.
    // When JLine/Minecraft prints `> \r[16:00:00 INFO]: ...`, taking the last \r segment preserves the overwritten line.
    const carriageParts = rawLine.split("\r");
    const line = carriageParts[carriageParts.length - 1] ?? rawLine;
    return line;
}

export function stripAnsi(input: string): string {
    if (!input) return "";
    return Anser.ansiToText(cleanTerminalLine(input));
}

export function parseAnsiToSegments(input: string): AnsiSegment[] {
    const cleaned = cleanTerminalLine(input);
    if (!cleaned) return [];

    const json = Anser.ansiToJson(cleaned, {
        use_classes: false,
        remove_empty: true,
    });

    return json.map((entry: any) => {
        const style: JSX.CSSProperties = {};

        if (entry.fg) {
            style.color = `rgb(${entry.fg})`;
        }
        if (entry.bg) {
            style.background = `rgb(${entry.bg})`;
        }
        if (entry.decoration === "bold" || entry.bold) {
            style["font-weight"] = 700;
        }
        if (entry.decoration === "italic" || entry.italic) {
            style["font-style"] = "italic";
        }
        if (entry.decoration === "underline" || entry.underline) {
            style["text-decoration"] = "underline";
        }

        return {
            text: entry.content,
            style,
        };
    });
}
