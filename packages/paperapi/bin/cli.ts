#!/usr/bin/env node
import { Command } from "commander";
import { packPanel } from "../src/pack";
import { linkPanel, unlinkPanel, listLinkedPanels } from "../src/link";

const program = new Command();
program.name("paperapi").description("PaperAPI Developer CLI");

program
    .command("link [panel-dir]")
    .alias("dev-link")
    .description("Link panel repository for live local development")
    .option("-f, --force", "overwrite existing link")
    .action((panelDir: string | undefined, opts: { force?: boolean }) => {
        const targetDir = panelDir ?? process.cwd();
        try {
            const res = linkPanel({ targetDir, force: opts.force });
            console.log(
                `\x1b[32m[PaperAPI Link]\x1b[0m Successfully linked \x1b[1m${res.name}\x1b[0m (\x1b[36m${res.id}\x1b[0m)`,
            );
            console.log(`  Source: ${res.sourcePath}`);
            console.log(`  Target: ${res.linkPath}`);
            console.log(`\nPanel is now active in Paperboard development mode!`);
        } catch (err: any) {
            console.error("\x1b[31m[PaperAPI Link Error]\x1b[0m", err.message);
            process.exit(1);
        }
    });

program
    .command("unlink <panel-id>")
    .description("Remove panel development link")
    .action((panelId: string) => {
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
    });

program
    .command("links")
    .alias("list-links")
    .description("List all active development links")
    .action(() => {
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
    });

program
    .command("pack [panel-dir]")
    .description("Build and package a panel into a release archive")
    .action((panelDir: string | undefined) => {
        const targetDir = panelDir ?? process.cwd();
        try {
            const result = packPanel({ targetDir });
            console.log("\nRelease Metadata JSON:\n", JSON.stringify(result, null, 2));
        } catch (err: any) {
            console.error("\x1b[31m[PaperAPI Pack Error]\x1b[0m", err.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
