// A tools file that couldn't be read, fixed by the person, in a real browser
// over the real service (test/support/panel.ts): its Try again has the
// service read tools.json again. Still broken, the failure stays, with the
// file's newest reason; fixed, the servers in it are listed and the failure
// goes.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { bootPanel, openSection, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const NOTES = { name: "notes", where: "host", transport: "stdio", command: "/bin/false", args: [], env: {}, enabled: false };
const FAILED = `document.querySelector(${JSON.stringify(`[role=dialog] [data-paper-error][aria-label="Couldn't read Ada's tools file"]`)})`;
const TRY_AGAIN = `[...${FAILED}.querySelectorAll("button")].find((b) => b.innerText.trim() === "Try again")`;

let panel: BootedPanel;
let page: Page;
let file: string;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, tools: "{ not a tools file" });
    file = path.join(panel.storage, "tools.json");
    page = await panel.open();
    await openSection(page, "Ada", "tools");
    await page.waitFor(FAILED, "the tools file's failure");
});
afterAll(() => panel?.close());

test("Try again on a tools file that's still broken keeps the failure, with its newest reason", async () => {
    const before = await page.evaluate<string>(`${FAILED}.innerText`);
    // broken another way: the service has to read it to know
    fs.writeFileSync(file, JSON.stringify({ actions: "yes", servers: [] }));
    await page.evaluate(`${TRY_AGAIN}.click()`);
    await page.waitFor(`${FAILED} && ${FAILED}.innerText !== ${JSON.stringify(before)} && !${TRY_AGAIN}.disabled`, "the newest reason");
    expect(await page.evaluate(`Boolean(${FAILED})`)).toBe(true);
});

test("Try again on a fixed tools file lists its servers, and the failure goes", async () => {
    fs.writeFileSync(file, JSON.stringify({ actions: false, servers: [NOTES] }));
    await page.evaluate(`${TRY_AGAIN}.click()`);
    await page.waitFor(`!${FAILED} && document.querySelector("[role=dialog]").innerText.includes("notes")`, "the fixed file's servers");
    expect(await page.evaluate(`document.querySelector("[data-paper-toasts] [role=alert]")`), "the read again is a failure").toBeNull();
    expect(page.exceptions).toEqual([]);
});
