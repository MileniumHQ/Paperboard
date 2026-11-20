#!/usr/bin/env bun
// Runs a suite with one headless Chrome for all of its test files:
//
//   bun withChrome.ts [--chrome-switch...] <command> [argument...]
//
// The command starts at the first word that isn't a switch.
//
// Chrome starts once, the command runs with TESTKIT_CHROME telling its test
// files where that Chrome is (chrome.ts opens their pages in it), and Chrome
// stops when the command ends, however it ends. The exit code is the
// command's.
import { spawn } from "node:child_process";
import { startChrome, SUITE_CHROME } from "./chrome";

const argv = process.argv.slice(2);
const split = argv.findIndex((word) => !word.startsWith("-"));
const command = split === -1 ? [] : argv.slice(split);
if (command.length === 0) {
    console.error("usage: withChrome.ts [--chrome-switch...] <command> [argument...]");
    process.exit(2);
}

const chrome = await startChrome(argv.slice(0, split));
const child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, [SUITE_CHROME]: JSON.stringify({ port: chrome.port, args: chrome.args }) },
});
// a signal to this process is meant for the suite: pass it on, and leave once the suite has
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
const code = await new Promise<number>((resolve) => {
    child.once("error", (err) => {
        console.error(`withChrome: could not run ${command[0]}: ${err.message}`);
        resolve(127);
    });
    child.once("exit", (status, signal) => resolve(status ?? (signal ? 1 : 0)));
});
await chrome.stop();
process.exit(code);
