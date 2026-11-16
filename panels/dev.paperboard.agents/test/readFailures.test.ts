// Reads that fail, in a real browser over the real service
// (test/support/panel.ts): a failed read stands until a read goes through,
// so it is said in place, as a PaperError, never as a toast. A view with
// nothing to show fills with it; one with its old list keeps the list under
// it; a card that can't check its page says so on the card; and a failure
// that's over isn't said any more. The pages fail to be read for real (their
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
const TOASTS = `[...document.querySelectorAll("[data-paper-toasts] [role=alert], [data-paper-toasts] [role=status]")].map((a) => a.innerText)`;
/** the failures said in place in `region`: each PaperError's name, words and buttons */
const errors = (region: string) =>
    `[...(${region}?.querySelectorAll("[data-paper-error]") ?? [])].map((e) => ({ title: e.getAttribute("aria-label"), role: e.getAttribute("role"), text: e.innerText, buttons: [...e.querySelectorAll("button")].map((b) => b.innerText.trim()) }))`;

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
    await view.waitFor(`${errors(CARD)}.some((e) => e.text.includes(${JSON.stringify(DENIED)}))`, "the pages' refusal on the card");
    results.firstCard = { toasts: await view.evaluate(TOASTS), errors: await view.evaluate(errors(CARD)), alerts: await view.evaluate(alerts(CARD)) };

    // the Pages page reads them too, and is refused; once they can be read, a read again finds the page
    await openSection(view, "Ada", "pages");
    await view.waitFor(`${errors(DIALOG)}.length === 1`, "the pages not to load");
    results.pagesPage = { errors: await view.evaluate(errors(DIALOG)), fill: await view.evaluate(`${DIALOG}.querySelector("[data-paper-error]").offsetHeight > ${DIALOG}.querySelector("[data-paper-error] button").offsetHeight * 3`), toasts: await view.evaluate(TOASTS) };
    fs.chmodSync(pagesDir, 0o755);
    await view.evaluate(`[...${DIALOG}.querySelectorAll("[data-paper-error] button")].find((b) => b.innerText.includes("Try again")).click()`);
    await view.waitFor(`${DIALOG}.innerText.includes("Report") && ${errors(DIALOG)}.length === 0 && ${errors(CARD)}.length === 0`, "the page in the list");

    // the pages change (another page is made), and the read that follows is refused
    await holdCalls(view, "pages");
    fs.mkdirSync(path.join(pagesDir, "notes"));
    fs.writeFileSync(path.join(pagesDir, "notes", "index.html"), page("Notes"));
    await view.waitFor(`window.__wireApi.heldCalls("pages") > 0`, "the pages read again after they changed");
    fs.chmodSync(pagesDir, 0o000);
    await holdCalls(view, "pages", false);
    await releaseCall(view, "pages");
    await view.waitFor(`${errors(DIALOG)}.some((e) => e.text.includes(${JSON.stringify(DENIED)}))`, "the read again's refusal");
    results.later = {
        toasts: await view.evaluate(TOASTS),
        errors: await view.evaluate(errors(DIALOG)),
        list: await view.evaluate(`[...${DIALOG}.querySelectorAll("[role=radio], [role=option], label")].some((r) => r.innerText.includes("Report"))`),
        card: await view.evaluate(errors(CARD)),
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
    await access.waitFor(`${errors(DIALOG)}.some((e) => e.title === "Couldn't load what's allowed")`, "the access refusal");
    results.accessRefused = { errors: await access.evaluate(errors(DIALOG)), toasts: await access.evaluate(TOASTS) };
    const other = await panel.open();
    await openSection(other, "Ada", "access");
    await other.waitFor(`document.querySelector('button[aria-label="Take back /srv/other"]')`, "the grants in the other window");
    await other.click('button[aria-label="Take back /srv/other"]');
    await access.waitFor(`${DIALOG}.innerText.includes("/srv/share")`, "the grants the service pushed");
    results.accessAfterPush = {
        refusal: await access.evaluate(`${errors(DIALOG)}.length > 0 || ${TOASTS}.length > 0`),
        grant: await access.evaluate(`${DIALOG}.innerText.includes("/srv/share")`),
    };
    results.uncaught = [...results.uncaught, ...access.exceptions, ...other.exceptions];
});
afterAll(async () => {
    if (pagesDir && fs.existsSync(pagesDir)) fs.chmodSync(pagesDir, 0o755);
    await panel?.close();
});

describe("a failed read", () => {
    test("of the pages is said in place, never as a toast: on the card that can't check its page, filling the Pages page, and over the list a read again couldn't replace", () => {
        expect(results.firstCard.toasts, "a failure that stands is a toast").toEqual([]);
        expect(results.firstCard.errors, "the card doesn't say once why it can't check its page").toHaveLength(1);
        expect(results.firstCard.errors[0]).toMatchObject({ title: "Couldn't check that it's still there", role: "region", buttons: ["Try again"] });
        expect(results.firstCard.errors[0].text).toContain(DENIED);
        expect(results.firstCard.alerts, "the card holds an alert of its own").toEqual([]);

        expect(results.pagesPage.toasts).toEqual([]);
        expect(results.pagesPage.errors[0]).toMatchObject({ title: "Couldn't load the pages", role: "region", buttons: ["Try again"] });
        expect(results.pagesPage.errors[0].text).toContain(DENIED);
        expect(results.pagesPage.fill, "the Pages page with nothing to show isn't filled by why").toBe(true);

        expect(results.later.toasts, "the failed read again is a toast").toEqual([]);
        expect(results.later.errors, "the failed read again isn't said over the list").toHaveLength(1);
        expect(results.later.errors[0]).toMatchObject({ title: "Couldn't load the pages", buttons: ["Try again"] });
        expect(results.later.errors[0].text).toContain(DENIED);
        expect(results.later.list, "the list that was read went").toBe(true);
        expect(results.later.card, "a card whose page was read still says it couldn't check").toEqual([]);
        expect(results.uncaught).toEqual([]);
    });

    test("of what's allowed fills the page in place, and gives way to the view the service pushes next", () => {
        expect(results.accessRefused.toasts).toEqual([]);
        expect(results.accessRefused.errors).toHaveLength(1);
        expect(results.accessRefused.errors[0]).toMatchObject({ title: "Couldn't load what's allowed", role: "region", buttons: ["Try again"] });
        expect(results.accessAfterPush).toEqual({ refusal: false, grant: true });
    });
});
