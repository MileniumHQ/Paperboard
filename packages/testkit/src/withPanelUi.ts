#!/usr/bin/env bun
// Runs a panel's suite with the panel's UI built once for all of its test
// files, run in the panel's folder:
//
//   bun withPanelUi.ts <command> [argument...]
//
// Building the UI is the slowest step of a browser test after starting
// Chrome. Built by each test process instead, it runs inside the first
// browser test's time limit, once per process, all at once: on a busy CI
// runner three builds side by side took 34 s of a test's 60. Here it is
// built before any test starts, the command runs with TESTKIT_PANEL_UI
// telling its test files where (panelUi.ts serves that build), and the build
// is removed when the command ends, however it ends: a signal during the
// build stops the build and nothing more runs. The exit code is the
// command's.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkPanelUiBuilt, panelUiBuild, SUITE_PANEL_UI } from "./panelUi";
import { runChild, runSuite, splitCommand, stoppedBy } from "./suite";

const { command } = splitCommand(process.argv.slice(2), "withPanelUi.ts <command> [argument...]", false);
const panelDir = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${path.basename(panelDir)}-ui-`));
let code = 1;
try {
    const build = await runChild("withPanelUi", panelUiBuild(dir), { capture: true });
    if (stoppedBy()) console.error(`withPanelUi: stopped (${stoppedBy()}) while building the panel UI`);
    else {
        checkPanelUiBuilt(dir, build.code, build.output);
        code = await runSuite("withPanelUi", command, { [SUITE_PANEL_UI]: JSON.stringify({ panelDir, dir }) });
    }
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
