import type { LearnPanel } from "./learn/panels";

interface Trademark {
    name: string;
    match: RegExp;
    owners: string[];
}

// Every third-party name the marketing pages may mention, with who owns it.
// A page's footer disclaims the ones its own copy names, so a page about
// Discord bots doesn't list game studios, and a new name in the copy needs a
// line here (test/trademarks.test.ts pins what each page disclaims).
export const TRADEMARKS: Trademark[] = [
    { name: "Minecraft", match: /\bMinecraft\b/, owners: ["Mojang Studios", "Microsoft"] },
    { name: "Terraria", match: /\bTerraria\b/, owners: ["Re-Logic"] },
    { name: "Palworld", match: /\bPalworld\b/, owners: ["Pocketpair"] },
    { name: "Team Fortress 2", match: /\bTeam Fortress 2\b|\bTF2\b/, owners: ["Valve"] },
    { name: "Discord", match: /\bDiscord\b/, owners: ["Discord Inc."] },
    { name: "Modrinth", match: /\bModrinth\b/, owners: ["Rinth, Inc."] },
    { name: "Codex", match: /\bCodex\b/, owners: ["OpenAI"] },
    { name: "Claude", match: /\bClaude\b/, owners: ["Anthropic"] },
    { name: "OpenCode", match: /\bOpenCode\b/, owners: ["Anomaly"] },
];

export interface TrademarkNotice {
    names: string[];
    owners: string[];
}

/** The trademarks named anywhere in `texts`, or undefined when none are. */
export function trademarkNotice(texts: string[]): TrademarkNotice | undefined {
    const named = TRADEMARKS.filter((mark) => texts.some((text) => mark.match.test(text)));
    if (!named.length) return undefined;
    return {
        names: named.map((mark) => mark.name),
        owners: [...new Set(named.flatMap((mark) => mark.owners))],
    };
}

/** Every piece of copy a panel's learn page shows, alt text included. */
export function learnPageText(panel: LearnPanel): string[] {
    return [
        panel.name,
        panel.headline,
        panel.description,
        panel.alt,
        panel.note ?? "",
        ...panel.features.flatMap((feature) => [feature.title, feature.description, feature.alt]),
    ];
}

/** The copy the landing's chapter for a panel shows. */
export function landingRowText(panel: LearnPanel): string[] {
    return [panel.name, panel.headline, panel.description, panel.alt];
}

/** "a", "a or b", "a, b, or c" */
export function listOf(items: string[], conjunction: "and" | "or"): string {
    if (items.length < 3) return items.join(` ${conjunction} `);
    return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;
}

/** Ends `text` with one full stop, even when it ends in "Inc." */
export function sentence(text: string): string {
    return text.endsWith(".") ? text : `${text}.`;
}
