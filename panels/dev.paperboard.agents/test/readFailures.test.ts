// Reads that fail, in a real browser over the real service
// (test/support/panel.ts): a failed read is a toast that says why, once
// however many cards read it; a view with nothing to show says it couldn't
// load, one with its old list keeps it; and a failure that's over isn't told. The pages fail to be read for real (their
// folder is made unreadable); the first read of what's allowed is refused by
// the real service, as the page's socket (test/support/wire.ts) lets it go
// with an input that call doesn't take.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { bootPanel, openSection, seedConversation, type BootedPanel } from "./support/panel";
import { holdCalls, releaseCall, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const page = (title: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>`;
const DENIED = "permission denied";

const DIALOG = `document.querySelector("[role=dialog]")`;
const CARD = `document.querySelector('[role=region][aria-label="Report"][data-message]')`;
const alerts = (region: string) => `[...${region}.querySelectorAll("[role=alert]")].map((a) => a.innerText)`;
const TOASTS = alerts(`document`).replace("[role=alert]", "[data-paper-toasts] [role=alert]");

let panel: BootedPanel;
let pagesDir: string;
const results: Record<string, any> = {};
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        storage: {
            "home/Pages/report/index.html": page("Report"),
            "app-info.json": { apps: { report: { title: "Report", description: "The month's numbers", kind: "document" }, notes: { title: "Notes", description: "What was said", kind: "document" } } },
            "access.json": { folders: [{ path: "/srv/share", at: 1 }, { path: "/srv/other", at: 2 }], commands: [] },
        },
        // the agent made the report in this conversation: its card is in the chat
        seed: async (storage) => void seedConversation(storage, [{ id: "e1", at: 1, kind: "app", app: "report", title: "Report", description: "The month's numbers" }]),
    });
    pagesDir = path.join(panel.storage, "home", "Pages");
    // the pages can't be read from the first read on
    fs.chmodSync(pagesDir, 0o000);
    const view = await panel.open({ init: WIRE });
    await view.waitFor(`${TOASTS}.some((a) => a.includes(${JSON.stringify(DENIED)}))`, "the pages' refusal");
    results.firstCard = { toasts: await view.evaluate(TOASTS), card: await view.evaluate(`${CARD}.innerText`), alerts: await view.evaluate(alerts(CARD)) };

    // the Pages page reads them too, and is refused; once they can be read, a read again finds the page
    await openSection(view, "Ada", "pages");
    await view.waitFor(`${DIALOG}.innerText.includes("Couldn't load")`, "the pages not to load");
    fs.chmodSync(pagesDir, 0o755);
    await view.evaluate(`[...${DIALOG}.querySelectorAll("button")].find((b) => b.innerText.includes("Try again")).click()`);
    await view.waitFor(`${DIALOG}.innerText.includes("Report") && ${TOASTS}.length === 0`, "the page in the list");

    // the pages change (another page is made), and the read that follows is refused
    await holdCalls(view, "pages");
    fs.mkdirSync(path.join(pagesDir, "notes"));
    fs.writeFileSync(path.join(pagesDir, "notes", "index.html"), page("Notes"));
    await view.waitFor(`window.__wireApi.heldCalls("pages") > 0`, "the pages read again after they changed");
    fs.chmodSync(pagesDir, 0o000);
    await holdCalls(view, "pages", false);
    await releaseCall(view, "pages");
    await view.waitFor(`${TOASTS}.some((a) => a.includes(${JSON.stringify(DENIED)}))`, "the read again's refusal");
    results.later = {
        toasts: await view.evaluate(TOASTS),
        list: await view.evaluate(`${DIALOG}.innerText.includes("Report")`),
        card: await view.evaluate(`${CARD}.innerText.includes("Couldn't check")`),
    };
    fs.chmodSync(pagesDir, 0o755);
    results.uncaught = view.exceptions;

    // what's allowed: the first read is refused, then another window takes a grant back and the service pushes the rest
    const access = await panel.open({ init: WIRE });
    await access.waitFor(`document.querySelector('[aria-label="Ada: computer and settings"]')`, "the chat");
    await holdCalls(access, "access");
    await access.click('[aria-label="Ada: computer and settings"]');
    await access.waitFor(`document.querySelector('input[name="ai-pages"][value="access"]')`, "the menu");
    await access.click('input[name="ai-pages"][value="access"]');
    await access.waitFor(`window.__wireApi.heldCalls("access") > 0`, "the first read of what's allowed");
    await holdCalls(access, "access", false);
    await releaseCall(access, "access", { refused: true });
    await access.waitFor(`${DIALOG}.innerText.includes("Couldn't load") && ${TOASTS}.some((a) => a.includes("Couldn't load what's allowed"))`, "the access refusal");
    const other = await panel.open();
    await openSection(other, "Ada", "access");
    await other.waitFor(`document.querySelector('button[aria-label="Take back /srv/other"]')`, "the grants in the other window");
    await other.click('button[aria-label="Take back /srv/other"]');
    await access.waitFor(`${DIALOG}.innerText.includes("/srv/share")`, "the grants the service pushed");
    results.accessAfterPush = {
        refusal: await access.evaluate(`${DIALOG}.innerText.includes("Couldn't load") || ${TOASTS}.length > 0`),
        grant: await access.evaluate(`${DIALOG}.innerText.includes("/srv/share")`),
    };
    results.uncaught = [...results.uncaught, ...access.exceptions, ...other.exceptions];
});
afterAll(async () => {
    if (pagesDir && fs.existsSync(pagesDir)) fs.chmodSync(pagesDir, 0o755);
    await panel?.close();
});

describe("a failed read", () => {
    test("of the pages is one toast, with Try again on a card when they were never read, and the list kept when a read again fails", () => {
        expect(results.firstCard.toasts, "the refusal isn't said once").toHaveLength(1);
        expect(results.firstCard.toasts[0]).toContain("Couldn't load the pages");
        expect(results.firstCard.toasts[0]).toContain(DENIED);
        expect(results.firstCard.card, "the card doesn't offer Try again").toContain("Try again");
        expect(results.firstCard.alerts, "the card holds an alert of its own").toEqual([]);
        expect(results.later.list, "the list that was read went").toBe(true);
        expect(results.later.toasts.some((a: string) => a.includes(DENIED)), "the failed read again isn't told").toBe(true);
        expect(results.later.card, "a card whose page was read still says it couldn't check").toBe(false);
        expect(results.uncaught).toEqual([]);
    });

    test("of what's allowed gives way to the view the service pushes next", () => {
        expect(results.accessAfterPush).toEqual({ refusal: false, grant: true });
    });
});
