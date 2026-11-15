// This computer's Paperboard Server going away and failing to start again:
// opening the shell says why, on screen.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;
// how long the host may take to try starting a server again (it tries within a second)
const RETRY_WAIT_MS = 20_000;

beforeAll(async () => {
    shell = await bootShell();
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a local server that can't start says why, never only that it is offline.
test("opening the shell while this computer's server can't start says why", async () => {
    const { page, dataDir } = shell;
    // the server stops, and the next one can't read its own tokens
    await shell.daemon.stop();
    const tokens = path.join(dataDir, "local", "authorized_tokens.json");
    fs.rmSync(tokens, { force: true });
    fs.mkdirSync(tokens);

    const shown = `document.body.innerText`;
    const url = await page.evaluate<string>("location.href");
    // until the shell's host has tried to start one, it can only say the
    // connection closed; it tries again within a second
    const deadline = Date.now() + RETRY_WAIT_MS;
    let said = "";
    while (!said.includes("couldn't start") && Date.now() < deadline) {
        await page.navigate(url);
        await page.waitFor(`${shown}.includes("Paperboard could not connect to its local server: ")`, "the shell to say it can't connect");
        said = await page.evaluate<string>(shown);
    }
    expect(said).toContain("Paperboard could not connect to its local server: Paperboard Server couldn't start on this computer: EISDIR");
    expect(said).not.toContain("CRANE_NOT_READY");
});
