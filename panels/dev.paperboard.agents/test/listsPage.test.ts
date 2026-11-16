// The menu's lists and the page view in a real browser over the real service
// (test/support/panel.ts): a list that changes keeps the rows that are still
// in it, and another page opens as a view of its own.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { Memory } from "../src/service/memory";
import { Routines } from "../src/service/routines";
import { bootPanel, markNodes, marked, openSection, type BootedPanel } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const page = (title: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>`;

let panel: BootedPanel;
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        storage: {
            "access.json": { folders: [1, 2, 3].map((n) => ({ path: `/srv/share-${n}`, at: n })), commands: [] },
            // two documents the agent made
            "home/Pages/report/index.html": page("Report"),
            "home/Pages/notes/index.html": page("Notes"),
            "app-info.json": { apps: { report: { title: "Report", description: "The month's numbers", kind: "document" }, notes: { title: "Notes", description: "What was said", kind: "document" } } },
        },
        // what the agent keeps, written by the service's own stores
        seed: async (storage) => {
            const routines = new Routines({ file: path.join(storage, "routines.json"), run: () => {}, onChange: () => {} });
            await routines.load();
            for (const what of ["Water the plants", "Back up the photos", "Check the mail"]) await routines.add(what, { kind: "every", minutes: 60 });
            await routines.shutdown();
            const memory = new Memory({ dir: path.join(storage, "memory"), onChange: () => {} });
            for (const fact of ["Likes tea", "Lives in Lyon", "Has a cat"]) await memory.addFact(fact);
        },
    });
});
afterAll(() => panel?.close());

describe("a list in the menu, when one of its items goes", () => {
    for (const [section, button, middle] of [
        ["routines", "Stop: ", "Back up the photos"],
        ["memories", "Forget: ", "Lives in Lyon"],
        ["access", "Take back ", "/srv/share-2"],
    ] as const) {
        test(`${section}: the other rows stay the rows they were`, async () => {
            const view = await panel.open();
            await openSection(view, "Ada", section);
            const rows = `[role=dialog] button[aria-label^="${button}"]`;
            await view.waitFor(`document.querySelectorAll('${rows}').length === 3`, `three ${section}`);
            expect(await markNodes(view, rows, "before")).toBe(3);
            await view.click(`[role=dialog] button[aria-label="${button}${middle}"]`);
            await view.waitFor(`document.querySelectorAll('${rows}').length === 2`, `the ${section} without one`);
            await view.settled();
            expect(await marked(view, rows, "before")).toEqual({ kept: 2, all: 2 });
            expect(view.exceptions).toEqual([]);
        });
    }
});

describe("the page view", () => {
    test("another page opens fresh, without the last one's failure", async () => {
        const view = await panel.open();
        const openPage = async (title: string) => {
            await openSection(view, "Ada", "pages");
            await view.waitFor(`document.body.innerText.includes(${JSON.stringify(title)})`, `${title} in the pages`);
            // the Open beside its Delete
            await view.evaluate(`[...document.querySelector('[role=dialog] button[aria-label="Delete “${title}”"]').parentElement.querySelectorAll("button")].find((b) => b.innerText.includes("Open")).dataset.testOpen = ${JSON.stringify(title)}`);
            await view.click(`button[data-test-open=${JSON.stringify(title)}]`);
            await view.waitFor(`document.querySelector('iframe[title=${JSON.stringify(title)}]')`, `${title} to open`);
        };
        const pane = `document.querySelector("iframe").closest("[class*=view]")`;
        await openPage("Report");
        // the agent's computer isn't set up, so saving the page as a PDF fails, and a toast says so
        await view.click(`button[aria-label="Save as PDF"]`);
        await view.waitFor(`document.querySelector("[data-paper-toasts] [role=alert]")?.innerText.includes("Couldn't save the PDF")`, "the PDF's failure");
        await view.settled();

        await openPage("Notes");
        expect(await view.evaluate(`${pane}.querySelector("[role=alert]")`)).toBeNull();
        expect(await view.evaluate(`document.querySelector('button[aria-label="Save as PDF"]').disabled`)).toBe(false);
        expect(view.exceptions).toEqual([]);
    });
});
