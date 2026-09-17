#!/usr/bin/env bun
// Scaffolds a new Paperboard panel from scripts/create-panel-template,
// copying every first-party convention: workspace package wiring, manifest
// shape (0.x version, no icon until you add branding/), PaperProvider
// bootstrap, explicit PANEL_ID plumbing in UI + service, typed service
// errors, hermetic tests, and one tested pure-logic unit.
//
// Usage: bun scripts/create-panel.ts [panel-id] [Display Name]
//   bun scripts/create-panel.ts dev.paperboard.my-panel "My Panel"
//   bun scripts/create-panel.ts            # prompts for everything
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/;
const PANEL_ID_MAX_LENGTH = 128;
const RESERVED_PANEL_IDS = ["library", "settings", "landing"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(ROOT, "scripts", "create-panel-template");

function fail(message: string): never {
    console.error(`create-panel: ${message}`);
    process.exit(1);
}

function usage(): never {
    console.error("Usage: bun scripts/create-panel.ts <panel-id> [Display Name]");
    console.error('Example: bun scripts/create-panel.ts dev.paperboard.my-panel "My Panel"');
    process.exit(1);
}

function defaultDisplayName(id: string): string {
    const last = id.split(".").pop() ?? id;
    return last
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

class PanelIdError extends Error {}

function assertValidPanelId(id: string): void {
    if (!id) {
        throw new PanelIdError("panel id is required");
    }
    if (id.length > PANEL_ID_MAX_LENGTH) {
        throw new PanelIdError(
            `panel id is ${id.length} characters (max ${PANEL_ID_MAX_LENGTH})`,
        );
    }
    if (!PANEL_ID_PATTERN.test(id)) {
        throw new PanelIdError(
            "panel id must be lowercase (letters, digits, dots, hyphens, underscores), e.g. dev.paperboard.my-panel",
        );
    }
    if (RESERVED_PANEL_IDS.includes(id)) {
        throw new PanelIdError(
            `"${id}" is reserved (library, settings and landing are app tabs)`,
        );
    }
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer.trim()));
    });
}

function copyTemplate(srcDir: string, destDir: string, replacements: Record<string, string>): string[] {
    const written: string[] = [];
    for (const entry of readdirSync(srcDir)) {
        const src = join(srcDir, entry);
        const dest = join(destDir, entry);
        if (statSync(src).isDirectory()) {
            mkdirSync(dest, { recursive: true });
            written.push(...copyTemplate(src, dest, replacements));
            continue;
        }
        let content = readFileSync(src, "utf8");
        for (const [token, value] of Object.entries(replacements)) {
            content = content.split(token).join(value);
        }
        writeFileSync(dest, content);
        written.push(dest);
    }
    return written;
}

async function main(): Promise<void> {
    const [, , argId, ...rest] = process.argv;
    if (argId === "--help" || argId === "-h") {
        console.log("Usage: bun scripts/create-panel.ts [panel-id] [Display Name]");
        console.log('Example: bun scripts/create-panel.ts dev.paperboard.my-panel "My Panel"');
        console.log("Run with no arguments for interactive prompts.");
        return;
    }

    let rawId = argId ?? "";
    let displayName = rest.join(" ").trim();
    let description = "";

    if (!rawId) {
        if (!process.stdin.isTTY) usage();
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            // loop until the id validates AND the target is free
            for (;;) {
                const answer = await ask(rl, "Panel id (e.g. dev.paperboard.my-panel): ");
                try {
                    assertValidPanelId(answer);
                } catch (err) {
                    console.error(`  ${(err as Error).message}`);
                    continue;
                }
                if (existsSync(resolve(ROOT, "panels", answer))) {
                    console.error(`  panels/${answer}/ already exists — pick another id`);
                    continue;
                }
                rawId = answer;
                break;
            }
            if (!displayName) {
                const fallback = defaultDisplayName(rawId);
                const answer = await ask(rl, `Display name [${fallback}]: `);
                displayName = answer || fallback;
            }
            const descAnswer = await ask(rl, `Description [${displayName} panel]: `);
            description = descAnswer || `${displayName} panel`;
        } finally {
            rl.close();
        }
    } else {
        try {
            assertValidPanelId(rawId);
        } catch (err) {
            fail((err as Error).message);
        }
        if (!displayName) displayName = defaultDisplayName(rawId);
        if (!description) description = `${displayName} panel`;
    }

    const targetDir = resolve(ROOT, "panels", rawId);
    if (existsSync(targetDir)) {
        fail(`"${targetDir}" already exists — pick another id or remove it first`);
    }
    if (!existsSync(TEMPLATE_DIR)) {
        fail(`template dir missing: ${TEMPLATE_DIR}`);
    }

    mkdirSync(targetDir, { recursive: true });
    const written = copyTemplate(TEMPLATE_DIR, targetDir, {
        __PANEL_ID__: rawId,
        __PANEL_NAME__: displayName,
        __PANEL_DESC__: description,
    });

    // fail loudly if a token survived (a new template file forgot a replacement)
    const leftovers: string[] = [];
    for (const file of written) {
        const content = readFileSync(file, "utf8");
        if (
            content.includes("__PANEL_ID__") ||
            content.includes("__PANEL_NAME__") ||
            content.includes("__PANEL_DESC__")
        ) {
            leftovers.push(file);
        }
    }
    if (leftovers.length > 0) {
        fail(`unreplaced template tokens in:\n  ${leftovers.join("\n  ")}`);
    }

    console.log(`Created ${written.length} files in panels/${rawId}/`);
    console.log("");
    console.log("Next steps:");
    console.log(`  1. bun install                # link workspace deps`);
    console.log(`  2. cd panels/${rawId} && bun test   # hermetic unit tests`);
    console.log(`  3. bun run build              # typecheck + UI + service bundles`);
    console.log(`  4. ln -s "$PWD" ~/.paperboard/panels/${rawId}   # load it in Paperboard`);
    console.log(`  5. Edit manifest.json (description, version) and make it yours.`);
}

main().catch((err) => {
    console.error(`create-panel: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
});
