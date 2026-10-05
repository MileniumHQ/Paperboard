#!/usr/bin/env bun
// In-repo entry for the panel scaffolder (packages/create-panel): writes
// panels/<panel-id>/ wired to the workspace libraries.
//
// Usage: bun scripts/create-panel.ts [panel-id] [Display Name]
//   bun scripts/create-panel.ts dev.paperboard.my-panel "My Panel"
//   bun scripts/create-panel.ts            # prompts for everything
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runCli } from "../packages/create-panel/src/scaffold";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

runCli({
    mode: "workspace",
    parentDir: join(ROOT, "panels"),
    command: "bun scripts/create-panel.ts",
    argv: process.argv.slice(2),
}).then(
    (code) => {
        process.exitCode = code;
    },
    (err) => {
        console.error(`create-panel: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
    },
);
