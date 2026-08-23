#!/usr/bin/env node
import { packPanel } from "../src/pack";
import { linkPanel, unlinkPanel, listLinkedPanels } from "../src/link";

const args = process.argv.slice(2);
const command = args[0];

if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
) {
    console.log(`
PaperAPI Developer CLI

Usage:
  paperapi link [panel-dir]                Link panel repository for live local development
  paperapi unlink <panel-id>               Remove panel development link
  paperapi links                           List all active development links
  paperapi pack [panel-dir]                Build and package a panel into a release archive
  --help, -h                               Show this help message
`);
    process.exit(0);
} else if (command === "link" || command === "dev-link") {
    const targetDir =
        args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    const force = args.includes("--force") || args.includes("-f");
    try {
        const res = linkPanel({ targetDir, force });
        console.log(
            `\x1b[32m[PaperAPI Link]\x1b[0m Successfully linked \x1b[1m${res.name}\x1b[0m (\x1b[36m${res.id}\x1b[0m)`,
        );
        console.log(`  Source: ${res.sourcePath}`);
        console.log(`  Target: ${res.linkPath}`);
        console.log(
            `\nPanel is now active in Paperboard development mode!`,
        );
    } catch (err: any) {
        console.error("\x1b[31m[PaperAPI Link Error]\x1b[0m", err.message);
        process.exit(1);
    }
} else if (command === "unlink") {
    const panelId = args[1];
    if (!panelId) {
        console.error(
            "\x1b[31m[PaperAPI Unlink Error]\x1b[0m Please provide a panel ID to unlink (e.g. paperapi unlink dev.paperboard.gameserver)",
        );
        process.exit(1);
    }
    try {
        const unlinked = unlinkPanel(panelId);
        if (unlinked) {
            console.log(
                `\x1b[32m[PaperAPI Unlink]\x1b[0m Successfully removed dev link for \x1b[1m${panelId}\x1b[0m`,
            );
        } else {
            console.log(
                `\x1b[33m[PaperAPI Unlink]\x1b[0m No active dev link found for ${panelId}`,
            );
        }
    } catch (err: any) {
        console.error("\x1b[31m[PaperAPI Unlink Error]\x1b[0m", err.message);
        process.exit(1);
    }
} else if (command === "links" || command === "list-links") {
    const links = listLinkedPanels();
    if (links.length === 0) {
        console.log("No active panel dev links found in ~/.paperboard/panels.");
    } else {
        console.log(`Active Panel Dev Links (${links.length}):`);
        for (const l of links) {
            const status = l.isBroken ? " \x1b[31m[BROKEN]\x1b[0m" : "";
            console.log(`  - \x1b[1m${l.id}\x1b[0m -> ${l.targetPath}${status}`);
        }
    }
} else if (command === "pack") {
    const targetDir =
        args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    try {
        const result = packPanel({ targetDir });
        console.log(
            "\nRelease Metadata JSON:\n",
            JSON.stringify(result, null, 2),
        );
    } catch (err: any) {
        console.error("\x1b[31m[PaperAPI Pack Error]\x1b[0m", err.message);
        process.exit(1);
    }
} else {
    console.log(`
PaperAPI Developer CLI

Usage:
  paperapi link [panel-dir]                Link panel repository for live local development
  paperapi unlink <panel-id>               Remove panel development link
  paperapi links                           List all active development links
  paperapi pack [panel-dir]                Build and package a panel into a release archive
  --help                                   Show this help message
`);
}

