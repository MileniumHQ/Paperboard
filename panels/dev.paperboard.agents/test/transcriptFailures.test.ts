// A failure the conversation keeps, in the real chat over the real service
// (test/support/panel.ts): a turn that failed and a request that failed at
// the service are records of the chat, so each is its card's own line, said
// as the chat says it every time it's opened. Neither is an alert, and
// neither is a toast: toasts are for what the person just did.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, seedConversation, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const TURN = "Codex stopped: the model is overloaded";
const REFUSED = "The vault refused the key";

let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        seed: async (storage) =>
            void seedConversation(storage, [
                { id: "u1", at: 1, kind: "user", text: "Fix the build" },
                { id: "e1", at: 2, kind: "error", title: "Not answered", text: TURN },
                { id: "p1", at: 3, kind: "prompt", title: "Connect Linear", reason: "To read your issues.", fields: [{ label: "API key", secret: { server: "linear", name: "api-key" } }], status: "failed", error: REFUSED },
            ]),
    });
    page = await panel.open();
    await page.waitFor(`document.querySelector('[data-message="p1"]')`, "the conversation");
});
afterAll(() => panel?.close());

const lineOf = (id: string) => `(document.querySelector('[data-message="${id}"] [data-card-error], [data-message="${id}"][data-card-error]')?.innerText ?? null)`;

describe("a failure the conversation keeps", () => {
    test("is its card's own line, not an alert or a toast", async () => {
        expect(await page.evaluate(lineOf("e1"))).toContain(TURN);
        expect(await page.evaluate(lineOf("e1"))).toContain("Not answered");
        expect(await page.evaluate(lineOf("p1"))).toEndWith(`Not sent: ${REFUSED}. Ada was told and can ask again.`);
        expect(await page.evaluate(`[...document.querySelectorAll("[role=alert]")].map((a) => a.innerText)`), "a record of the chat is an alert").toEqual([]);
        expect(await page.evaluate(`document.querySelector("[data-paper-toasts]")`), "a record of the chat is a toast").toBeNull();
        expect(page.exceptions).toEqual([]);
    });
});
