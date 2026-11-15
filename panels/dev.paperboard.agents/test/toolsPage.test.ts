// The Tools page in a real browser over the real service (test/support/panel.ts):
// what a person types and switches stays where they put it while the page
// saves and the service pushes the servers' status.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blankForm, newRow, specFromForm } from "../src/tools/form";
import { bootPanel, markNodes, marked, openSection, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
// a server that is off; switched on, it starts when the agent first needs it
const NOTES = { name: "notes", where: "host", transport: "stdio", command: "/bin/false", args: [], env: {}, enabled: false };
// one the agent set up: its secret's vault name is its own, not one made from the variable's name
const LINEAR = { name: "linear", where: "host", transport: "stdio", command: "/bin/false", args: [], env: { LINEAR_KEY: { secret: "linear-key" } }, enabled: false };

let panel: BootedPanel;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, tools: { actions: false, servers: [NOTES, LINEAR] } });
});
afterAll(() => panel?.close());

async function toolsPage(): Promise<Page> {
    const page = await panel.open();
    await openSection(page, "Ada", "tools");
    await page.waitFor(`document.body.innerText.includes("Add a server")`, "the tool servers");
    return page;
}

/** Opens the editor for a new server; resolves once its Name field shows. */
async function newServer(page: Page): Promise<void> {
    await page.click(`input[name="agents-tools"][value="new"]`);
    await page.waitFor(`${EDITOR}?.querySelector('input[name="name"]')`, "the new server's editor");
}

// the server editor is the form in a dialog (the menu is a dialog of its own, around the Tools page);
// a variable's row is the group its Remove button is in, and its first field is its Name
const EDITOR = `document.querySelector("[role=dialog] form")`;
const ROWS = `[...${EDITOR}.querySelectorAll('button[aria-label^="Remove "]')].map((b) => b.closest("[role=group]"))`;
const addRow = async (page: Page, rows: number) => {
    await page.evaluate(`[...${EDITOR}.querySelectorAll("button")].find((b) => b.innerText.includes("Add a variable")).dataset.testAdd = "1"`);
    await page.click(`button[data-test-add]`);
    await page.waitFor(`${ROWS}.length === ${rows}`, `${rows} variable rows`);
};

/**
 * Types `text` one character at a time into whatever has the keyboard, as
 * keys pressed one after another would, and says after each one whether the
 * field it started in still has the keyboard and is still on the page.
 */
const typeKeys = (page: Page, text: string) =>
    page.evaluate<{ stayed: boolean; value: string }>(`(() => {
        const field = document.activeElement;
        let stayed = true;
        for (const ch of ${JSON.stringify(text)}) {
            document.execCommand("insertText", false, ch);
            stayed &&= document.activeElement === field && field.isConnected;
        }
        return { stayed, value: field.value };
    })()`);

describe("the tool server editor", () => {
    test("typing in a variable's Name and Value keeps the keyboard in that field", async () => {
        const page = await toolsPage();
        await newServer(page);
        await addRow(page, 1);
        await page.evaluate(`${ROWS}[0].querySelector("input").focus()`);
        expect(await typeKeys(page, "API_HOST")).toEqual({ stayed: true, value: "API_HOST" });
        // the row's Value: its field after its Name that isn't its Kind
        await page.evaluate(`[...${ROWS}[0].querySelectorAll('input:not([name^="kind-"])')][1].focus()`);
        expect(await typeKeys(page, "localhost")).toEqual({ stayed: true, value: "localhost" });
        expect(page.exceptions).toEqual([]);
    });

    test("Save with no name says why where it can be seen, and puts the keyboard in Name", async () => {
        const page = await toolsPage();
        // a short window: five variables push the bottom of the form out of view
        await page.resize(1000, 560);
        await newServer(page);
        for (let rows = 1; rows <= 5; rows++) await addRow(page, rows);
        await page.evaluate(`${EDITOR}.requestSubmit()`);
        await page.waitFor(`${EDITOR}.querySelector("[role=alert]")`, "the refusal");
        // the refusal is inside the part of the editor that shows: neither scrolled away nor below the window
        const seen = await page.evaluate<{ alert: DOMRect; view: DOMRect }>(`(() => {
            const alert = ${EDITOR}.querySelector("[role=alert]");
            let view = alert.parentElement;
            while (view && !(view.scrollHeight > view.clientHeight && /auto|scroll/.test(getComputedStyle(view).overflowY))) view = view.parentElement;
            const box = (view ?? document.documentElement).getBoundingClientRect();
            return { alert: alert.getBoundingClientRect().toJSON(), view: { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, innerHeight) } };
        })()`);
        expect(seen.alert.top).toBeGreaterThanOrEqual(seen.view.top);
        expect(seen.alert.bottom).toBeLessThanOrEqual(seen.view.bottom);
        // the editor moves to the field as it shows the refusal, before the page does anything else
        expect(await page.evaluate<boolean>(`document.activeElement === ${EDITOR}.querySelector('input[name="name"]')`)).toBe(true);
        expect(page.exceptions).toEqual([]);
    });

    test("saving a server the agent set up keeps its secret where the vault has it", async () => {
        const page = await toolsPage();
        await page.click(`input[name="agents-tools"][value="server:linear"]`);
        await page.waitFor(`${EDITOR}?.querySelector('input[name="name"]')?.value === "linear"`, "linear's editor");
        await page.evaluate(`${EDITOR}.requestSubmit()`);
        await page.waitFor(`!${EDITOR}`, "the editor to close once saved");
        const saves = page.sentFrames.filter((f) => f.includes('"command":"/bin/false"') && f.includes("LINEAR_KEY"));
        expect(saves).toHaveLength(1);
        expect(saves[0]).toContain('"LINEAR_KEY":{"secret":"linear-key"}');
        expect(page.exceptions).toEqual([]);
    });

    test("two new secrets that would share one vault name are refused, never one saved over the other", () => {
        const rows = [newRow({ name: "API_KEY", kind: "secret", typed: "one" }), newRow({ name: "api_key", kind: "secret", typed: "two" })];
        expect(() => specFromForm({ ...blankForm(), name: "web", command: "/bin/false", rows })).toThrow("API_KEY and api_key would keep their secrets under one name");
    });
});

describe("a server's switch", () => {
    test("flips at once and stays usable through its own save, as does the rest of the page; is the same switch through the status the service pushes; and ends on", async () => {
        const page = await toolsPage();
        const toggle = `[role=switch][aria-label="notes on"]`;
        const others = `[role=switch][aria-label="Let it use your other panels"]`;
        await page.waitFor(`document.querySelector('${toggle}')?.getAttribute("aria-checked") === "false"`, "the server's switch, off");
        expect(await markNodes(page, toggle, "before")).toBe(1);
        // pressed, and looked at in the same moment: the save has only just left
        const pressed = await page.evaluate<{ checked: string | null; disabled: string | null; othersDisabled: string | null }>(`(() => {
            document.querySelector('${toggle}').click();
            const at = (s) => document.querySelector(s);
            return { checked: at('${toggle}').getAttribute("aria-checked"), disabled: at('${toggle}').getAttribute("aria-disabled"), othersDisabled: at('${others}').getAttribute("aria-disabled") };
        })()`);
        expect(pressed).toEqual({ checked: "true", disabled: null, othersDisabled: null });
        // the service saves it and pushes the servers' status with it on
        await page.received((f) => f.includes(":tools-changed") && f.includes('"enabled":true'), "the servers' status, pushed with the server on");
        await page.settled();
        expect(await marked(page, toggle, "before")).toEqual({ kept: 1, all: 1 });
        expect(await page.evaluate(`document.querySelector('${toggle}').getAttribute("aria-checked")`)).toBe("true");
        expect(await page.evaluate(`document.querySelector('${toggle}').getAttribute("aria-disabled")`)).not.toBe("true");
        expect(page.exceptions).toEqual([]);
    });
});
