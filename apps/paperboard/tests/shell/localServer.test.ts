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

    // it says so in PaperUI, in the system's theme, with a way to try again
    const look = `(() => {
        const alert = document.querySelector("[role=alert]");
        return {
            alert: alert?.innerText ?? null,
            retry: [...(alert?.querySelectorAll("button") ?? [])].some((b) => b.innerText.trim() === "Retry"),
            // what the page is painted with: the nearest backdrop behind the alert
            background: (() => {
                for (let el = alert; el; el = el.parentElement) {
                    const color = getComputedStyle(el).backgroundColor;
                    if (color !== "rgba(0, 0, 0, 0)") return color;
                }
                return null;
            })(),
            text: alert ? getComputedStyle(alert.querySelector("h1, h2, h3, [class*=title]") ?? alert).color : null,
        };
    })()`;
    const themed = async (scheme: "light" | "dark") => {
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
        await page.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        return page.evaluate<{ alert: string | null; retry: boolean; background: string | null; text: string | null }>(look);
    };
    const light = await themed("light");
    const dark = await themed("dark");
    for (const shown of [light, dark]) {
        expect(shown.alert).toContain("Paperboard could not connect to its local server: ");
        expect(shown.retry).toBe(true);
        expect(shown.background).not.toBeNull();
    }
    expect(dark.background).not.toBe(light.background);
    expect(dark.text).not.toBe(light.text);
});
