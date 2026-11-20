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
import { startChrome, SUITE_CHROME } from "./chrome";
import { runSuite, splitCommand } from "./suite";

const { switches, command } = splitCommand(process.argv.slice(2), "withChrome.ts [--chrome-switch...] <command> [argument...]", true);
const chrome = await startChrome(switches);
const code = await runSuite("withChrome", command, { [SUITE_CHROME]: JSON.stringify({ port: chrome.port, args: chrome.args }) });
await chrome.stop();
process.exit(code);
