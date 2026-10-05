#!/usr/bin/env node
// `npm create @mileniumhq/panel [panel-id] [Display Name]`
// Writes ./<panel-id>/ in the current directory.
import { runCli } from "../src/scaffold";

runCli({
    mode: "standalone",
    parentDir: process.cwd(),
    command: "npm create @mileniumhq/panel",
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
