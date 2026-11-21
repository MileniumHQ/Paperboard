// The Tools page in a real browser over the real service (test/support/panel.ts):
// what a person types and switches stays where they put it while the page
// saves and the service pushes the servers' status.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blankForm, newRow, specFromForm } from "../src/tools/form";
import { bootPanel, openSection, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
// a server that is off; switched on, it starts when the agent first needs it
const NOTES = { name: "notes", where: "host", transport: "stdio", command: "/bin/false", args: [], env: {}, enabled: false };
// one the agent set up: its secret's vault name is its own, not one made from the variable's name
const LINEAR = { name: "linear", where: "host", transport: "stdio", command: "/bin/false", args: [], env: { LINEAR_KEY: { secret: "linear-key" } }, enabled: false };

let panel: BootedPanel;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, tools: { blocks: false, servers: [NOTES, LINEAR] } });
});
afterAll(() => panel?.close());

async function toolsPage(): Promise<Page> {
    const page = await panel.open();
    await openSection(page, "Ada", "tools");
    await page.waitFor(`document.body.innerText.includes("Add a server")`, "the tool servers");
    return page;
}

// the server editor is the form in a dialog (the menu is a dialog of its own, around the Tools page)
const EDITOR = `document.querySelector("[role=dialog] form")`;

describe("the tool server editor", () => {
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
