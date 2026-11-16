// The starter's pages in a real browser (scripts/testing/chrome.ts), built
// with the scaffolded panel's own vite config and served the way the shell
// serves a panel (scripts/testing/panelUi.ts), over the real daemon. What a
// page couldn't load stays where the page is, with a way to try again,
// never only in a toast that goes by itself.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { getTransport } from "@mileniumhq/paperapi";
import { launchChrome, type Chrome, type Page } from "../../../scripts/testing/chrome";
import { PANEL_DOC, panelHostUrl, servePanelUi } from "../../../scripts/testing/panelUi";
import { scaffoldPanel } from "../src/scaffold";
import { startDaemon, type Daemon } from "./helpers/daemon";
import { linkDependencies, tempDir } from "./helpers/panel";

const TIMEOUT = 180_000;
const ID = "dev.example.pages";

let parent: string;
let daemon: Daemon;
let chrome: Chrome;
let served: { url: string; stop: () => void };
let refused: { url: string; stop: () => void };

// The panel isn't linked into the daemon's folder, so its service never
// starts: the Service page can't reach it. Served again with a token the
// daemon never issued, every call it makes is refused, the Notes page's
// config read among them.
beforeAll(async () => {
    parent = tempDir("pages");
    const dir = scaffoldPanel({ mode: "standalone", id: ID, parentDir: parent, features: { service: true, widget: false, store: false } }).targetDir;
    linkDependencies(dir);
    daemon = await startDaemon();
    const granted = await getTransport().call("auth:panel-token", { panelId: ID });
    served = servePanelUi({ panelDir: dir, panelId: ID, port: daemon.port, token: granted.token, mobile: false });
    refused = servePanelUi({ panelDir: dir, panelId: ID, port: daemon.port, token: `pcp_${"0".repeat(48)}`, mobile: false });
    chrome = await launchChrome({ windowSize: "860,560" });
}, TIMEOUT);

afterAll(async () => {
    await chrome?.close();
    served?.stop();
    refused?.stop();
    await daemon?.stop();
    rmSync(parent, { recursive: true, force: true });
});

// the page's error region named `title`, and what it says and offers
const failure = (title: string) => `(() => {
    const region = [...(${PANEL_DOC}?.querySelectorAll("[role=region]") ?? [])].find((el) => el.getAttribute("aria-label") === ${JSON.stringify(title)});
    if (!region || region.getClientRects().length === 0) return null;
    return { text: region.innerText, buttons: [...region.querySelectorAll("button")].map((b) => b.innerText.trim()) };
})()`;

// the toasts the page shows
const toasts = `[...(${PANEL_DOC}?.querySelectorAll("[role=region][aria-label=Notifications] [role=alert], [role=region][aria-label=Notifications] [role=status]") ?? [])].map((t) => t.innerText)`;

async function openTab(page: Page, value: string): Promise<void> {
    const item = `${PANEL_DOC}?.querySelector("input[name=starter-menu][value=${value}]")?.closest("label")`;
    await page.waitFor(item, `the ${value} menu item`);
    await page.evaluate(`${item}.click()`);
}

describe("the starter's pages say what they couldn't load where it would be", () => {
    // Inventory: Core contracts — the starter teaches a failure that stands in place, with Try again.
    test(
        "the Service page that can't reach its service fills with the failure and a Try again, and no toast",
        async () => {
            const page = await chrome.open(panelHostUrl(served.url));
            await openTab(page, "service");
            await page.waitFor(failure("Couldn't reach the service"), "the Service page's failure");
            const said = await page.evaluate<{ text: string; buttons: string[] }>(failure("Couldn't reach the service"));
            expect(said.buttons).toEqual(["Try again"]);
            expect(said.text.split("\n").filter(Boolean).length).toBeGreaterThan(1);
            expect(await page.evaluate<string[]>(toasts)).toEqual([]);
            expect(page.exceptions).toEqual([]);
            await page.close();
        },
        TIMEOUT,
    );

    test(
        "the Notes page whose note can't be read fills with the failure, and Try again reads it again",
        async () => {
            const page = await chrome.open(panelHostUrl(refused.url));
            await openTab(page, "notes");
            const note = failure("Couldn't load the note");
            await page.waitFor(note, "the Notes page's failure");
            const said = await page.evaluate<{ text: string; buttons: string[] }>(note);
            expect(said.buttons).toEqual(["Try again"]);
            expect(said.text.split("\n").filter(Boolean).length).toBeGreaterThan(1);
            expect(await page.evaluate<boolean>(`!${PANEL_DOC}.querySelector("input[aria-label=Note], textarea")`)).toBe(true);
            expect(await page.evaluate<string[]>(toasts)).toEqual([]);

            // Try again asks once more: it asks the daemon again, and the failure stands once it is refused again
            const button = `[...${PANEL_DOC}.querySelectorAll("[role=region] button")].find((b) => b.innerText.trim() === "Try again")`;
            const asked = () => page.sentFrames.filter((frame) => frame.includes('"auth:verify"')).length;
            const before = asked();
            await page.evaluate(`${button}.click()`);
            await page.waitFor(`${button} && !${button}.disabled`, "Try again, free once the read is refused");
            expect(asked()).toBeGreaterThan(before);
            expect(await page.evaluate(note)).not.toBeNull();
            expect(await page.evaluate<string[]>(toasts)).toEqual([]);
            expect(page.exceptions).toEqual([]);
            await page.close();
        },
        TIMEOUT,
    );
});
