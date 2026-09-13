#!/usr/bin/env bun
/**
 * scrape-gamerules.ts — Generates gamerules.generated.ts from the Minecraft Wiki
 *
 * Usage: bun run scrape-gamerules.ts
 * Output: ../../panels/dev.paperboard.gameserver/src/generated/gamerules.generated.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

const API_URL = "https://minecraft.wiki/api.php";
const USER_AGENT = "PaperboardDevUtils/1.0 (gamerules generator)";
const OUT_FILE = join(import.meta.dir, "..", "..", "..", "panels", "dev.paperboard.gameserver", "src", "generated", "gamerules.generated.ts");

interface GameruleEntry {
    name: string;
    category: string;
    description: string;
    defaultValue: string;
    valueType: string;
    addedIn?: string;
}

// ─── Wikitext fetching ──────────────────────────────────────────────────────

async function fetchWikitext(page: string): Promise<string> {
    const url = `${API_URL}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Wiki API returned HTTP ${res.status}`);
    const json: any = await res.json();
    if (json.error) throw new Error(`Wiki API error: ${json.error.info}`);
    return json.parse.wikitext as string;
}

// ─── Wikitext cleanup ───────────────────────────────────────────────────────

function stripMarkup(text: string): string {
    return text
        .replace(/<ref[^>]*\/>/g, "")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        // {{cd|a|b|c}} → "a, b or c"-ish inline code
        .replace(/\{\{cd\|([^}|]*)((?:\|[^{}]*)*)\}\}/g, (_m, first: string, rest: string) => {
            const parts = [first, ...rest.split("|").filter(Boolean)];
            return parts.length > 1 ? parts.join("/") : first;
        })
        .replace(/\{\{va\|([^}|]+)\}\}/g, "$1")
        .replace(/\{\{nowrap\|([\s\S]*?)\}\}/gi, "$1")
        .replace(/\{\{nowrap\|([\s\S]*?)\}\}/g, "$1")
        // [[link|label]] → label, [[link]] → link
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
        // remaining simple text templates {{IN|java}} etc
        .replace(/\{\{(?:IN\|)?(java|bedrock|JE|BE)[^}]*\}\}/gi, (_m, p1) => (String(p1).toLowerCase() === "java" ? "Java Edition" : "Bedrock Edition"))
        .replace(/\{\{[^{}]*\}\}/g, "")
        .replace(/<code>|<\/code>|<br\s*\/?>/gi, " ")
        .replace(/'''''|'''|''/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ─── Game rule list parsing ─────────────────────────────────────────────────

function parseRuleList(wikitext: string): GameruleEntry[] {
    const listStart = wikitext.indexOf("== List of game rules ==");
    const historyStart = wikitext.indexOf("== History ==");
    if (listStart === -1 || historyStart === -1) throw new Error("Could not find expected sections");
    const section = wikitext.slice(listStart, historyStart);

    const entries: GameruleEntry[] = [];
    let currentCat = "";

    interface Row {
        cat: string;
        lines: string[];
    }
    const rows: Row[] = [];
    let currentRow: Row | null = null;

    for (const line of section.split("\n")) {
        const catMatch = line.match(/^===\s*(.+?)\s*===$/);
        if (catMatch) {
            currentCat = stripMarkup(catMatch[1]).trim();
            continue;
        }
        if (line.startsWith("|-")) {
            currentRow = { cat: currentCat, lines: [] };
            rows.push(currentRow);
            continue;
        }
        if (/^\|\}/.test(line)) {
            currentRow = null;
            continue;
        }
        if (currentRow && line.startsWith("|")) {
            currentRow.lines.push(line.replace(/^\|\s*/, ""));
        } else if (currentRow && currentRow.lines.length > 0) {
            // Continuation of the previous cell
            currentRow.lines[currentRow.lines.length - 1] += "\n" + line;
        }
    }

    const stripStylePrefix = (cell: string) => cell.replace(/^style\s*=\s*"[^"]*"\s*\|\s*/i, "");

    for (const row of rows) {
        const cells = row.lines.map(stripStylePrefix);
        const cleaned = cells.map(stripMarkup);
        if (cleaned.length < 4) continue;

        const rawNameCell = cells[0];
        const jeSegment = rawNameCell.includes("{{el|be")
            ? rawNameCell.split(/\{\{el\|be/i)[0]
            : rawNameCell;
        const vaMatches = [...jeSegment.matchAll(/\{\{va\|([^}|]+)\}\}/g)].map((m) => m[1].trim());
        let name = vaMatches[0] ?? "";
        if (!name) continue;
        name = name.replace(/^minecraft:/, "");

        entries.push({
            name,
            category: row.cat,
            description: cleaned[1] ?? "",
            defaultValue: cleaned[2] ?? "",
            valueType: /^bool/i.test(cleaned[3] ?? "") ? "boolean" : /int/i.test(cleaned[3] ?? "") ? "number" : "string",
        });
    }

    return entries;
}

// ─── History parsing ────────────────────────────────────────────────────────

interface HistoryEvent {
    version?: string;
    snapshot?: string;
    text: string;
}

function parseHistory(wikitext: string): HistoryEvent[] {
    const start = wikitext.indexOf("== History ==");
    if (start === -1) return [];
    const section = wikitext.slice(start);

    const events: HistoryEvent[] = [];

    // Manual scan: find {{HistoryLine ... }} blocks allowing nested single-level braces
    const src = section;
    let i = src.indexOf("{{HistoryLine");
    while (i !== -1) {
        let depth = 1;
        let j = i + 2;
        while (j < src.length && depth > 0) {
            if (src[j] === "{" && src[j + 1] === "{") { depth++; j += 2; continue; }
            if (src[j] === "}" && src[j + 1] === "}") { depth--; j += 2; continue; }
            j++;
        }
        const body = src.slice(i + "{{HistoryLine".length, j - 2);

        const fields: string[] = [];
        let buf = "";
        let d = 0;
        for (let k = 0; k < body.length; k++) {
            if (body[k] === "{" && body[k + 1] === "{") { d++; buf += "{{"; k++; continue; }
            if (body[k] === "}" && body[k + 1] === "}") { d--; buf += "}}"; k++; continue; }
            if (body[k] === "|" && d === 0) { fields.push(buf); buf = ""; continue; }
            buf += body[k];
        }
        fields.push(buf);

        // Body starts with a leading pipe: ["", section?, version?, rest…]
        const version = fields[2]?.trim() || undefined;
        const joinedRest = fields.slice(3).join("|");
        const snapshot = joinedRest.match(/dev=([^|}\n]*)/)?.[1]?.trim() || undefined;
        const text = joinedRest.replace(/^dev=[^|}\n]*\|?/, "");

        events.push({ version, snapshot, text });

        i = src.indexOf("{{HistoryLine", j);
    }

    return events;
}

function effectiveVersion(ev: HistoryEvent): string | undefined {
    const v = ev.version ?? ev.snapshot;
    // Only Java-style versions are useful for gating ("pocket", section
    // markers, etc. are not).
    if (!v || !/^\d/.test(v)) return undefined;
    return v;
}

function applyHistory(entries: GameruleEntry[], rawEvents: HistoryEvent[]) {
    const byCanonical = new Map<string, GameruleEntry>();
    for (const e of entries) byCanonical.set(e.name.toLowerCase(), e);

    // Wiki history tables inherit the version cell downward: a row with an
    // empty version belongs to the release named above it.
    const events: HistoryEvent[] = [];
    let lastRelease: string | undefined;
    for (const ev of rawEvents) {
        if (ev.version && /^\d/.test(ev.version)) lastRelease = ev.version;
        if (!ev.version && ev.snapshot && lastRelease) {
            events.push({ ...ev, version: lastRelease });
        } else {
            events.push(ev);
        }
    }

    for (const ev of events) {
        const ver = effectiveVersion(ev);
        if (!ver) continue;

        // "Added the following gamerules:" followed by * {{cd|Name}} bullets
        const bulletNames = [...ev.text.matchAll(/^\s*\*\s*\{\{cd\|([^}|]+)\}\}/gm)].map((m) => m[1].trim());
        // Inline mentions: Added/Removed game rule {{cd|Name}}
        const inlineNames = [...ev.text.matchAll(/(Added|Removed|Renamed)[^.\n]*?\{\{cd\|([^}|]+)\}\}/g)].map(
            (m) => ({ verb: m[1].toLowerCase(), name: m[2].trim() }),
        );

        for (const b of bulletNames) {
            const entry = byCanonical.get(b.toLowerCase()) ?? byCanonical.get(camelToSnake(b));
            if (entry && !entry.addedIn) entry.addedIn = ver;
        }

        for (const { verb, name } of inlineNames) {
            const entry =
                byCanonical.get(name.toLowerCase()) ?? byCanonical.get(camelToSnake(name)) ?? byCanonical.get(snakeToCamel(name.toLowerCase()));
            if (!entry) continue;

            if (verb === "added") {
                if (!entry.addedIn) entry.addedIn = ver;
            }
        }
    }
}

function camelToSnake(s: string): string {
    return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function snakeToCamel(s: string): string {
    return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

// ─── Code generation ────────────────────────────────────────────────────────

function tsString(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function generate(entries: GameruleEntry[]): string {
    const live = entries.filter(
        (e) => !/bedrock/i.test(e.category),
    );

    const lines: string[] = [];
    lines.push("// GENERATED FILE — do not edit by hand.");
    lines.push(`// Source: minecraft.wiki /w/Game_rule (scraped ${new Date().toISOString().slice(0, 10)})`);
    lines.push("// Regenerate with: bun run Paperboard/devutils/scrape-gamerules.ts");
    lines.push("");
    lines.push("export interface GameruleEntry {");
    lines.push("    name: string;");
    lines.push("    category: string;");
    lines.push("    description: string;");
    lines.push("    defaultValue: string;");
    lines.push('    valueType: "boolean" | "number" | "string";');
    lines.push("    addedIn?: string;");
    lines.push("}");
    lines.push("");
    lines.push("export const GAMERULES: GameruleEntry[] = [");
    for (const e of live) {
        lines.push("    {");
        lines.push(`        name: ${tsString(e.name)},`);
        lines.push(`        category: ${tsString(e.category)},`);
        lines.push(`        description: ${tsString(e.description)},`);
        lines.push(`        defaultValue: ${tsString(e.defaultValue)},`);
        lines.push(`        valueType: ${tsString(e.valueType)} as const,`);
        if (e.addedIn) lines.push(`        addedIn: ${tsString(e.addedIn)},`);
        lines.push("    },");
    }
    lines.push("];");
    lines.push("");

    return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

const wikitext = await fetchWikitext("Game rule");
const entries = parseRuleList(wikitext);
const events = parseHistory(wikitext);
applyHistory(entries, events);

const usable = entries.filter((e) => !/bedrock/i.test(e.category));
console.log(`Parsed ${entries.length} gamerules (${usable.length} Java Edition, ${entries.filter((e) => !/bedrock/i.test(e.category)).length} currently live)`);

writeFileSync(OUT_FILE, generate(entries));
console.log(`Written to ${OUT_FILE}`);
