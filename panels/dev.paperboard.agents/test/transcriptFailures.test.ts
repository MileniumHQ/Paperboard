// A failure the conversation keeps, in the real chat over the real service
// (test/support/panel.ts): a turn that failed and a request that failed at
// the service are records of the chat, so each is a PaperError where it
// happened (the turn's place in the chat, the request's card), said as the
// chat says it every time it's opened. Neither is an alert, and neither is a
// toast: toasts are for what the person just did.
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

/** the PaperError a message holds (or is): its name, role and words */
const errorOf = (id: string) =>
    `(() => { const e = document.querySelector('[data-message="${id}"] [data-paper-error]'); return e && { title: e.getAttribute("aria-label"), role: e.getAttribute("role"), text: e.innerText }; })()`;

describe("a failure the conversation keeps", () => {
    test("is a PaperError where it happened, not an alert or a toast", async () => {
        const turn = await page.evaluate<{ title: string; role: string; text: string } | null>(errorOf("e1"));
        expect(turn, "the failed turn isn't a PaperError").not.toBeNull();
        expect(turn).toMatchObject({ title: "Not answered", role: "region" });
        expect(turn!.text).toContain(TURN);
        const request = await page.evaluate<{ title: string; role: string; text: string } | null>(errorOf("p1"));
        expect(request, "the failed request isn't a PaperError on its card").not.toBeNull();
        expect(request).toMatchObject({ title: "Not sent", role: "region" });
        expect(request!.text).toContain(`${REFUSED}. Ada was told and can ask again.`);
        // the card is still the request's: its title is there with the failure
        expect(await page.evaluate(`document.querySelector('[data-message="p1"]').innerText`)).toContain("Connect Linear");
        expect(await page.evaluate(`[...document.querySelectorAll("[role=alert]")].map((a) => a.innerText)`), "a record of the chat is an alert").toEqual([]);
        expect(await page.evaluate(`document.querySelector("[data-paper-toasts] [role=alert], [data-paper-toasts] [role=status]")`), "a record of the chat is a toast").toBeNull();
        expect(page.exceptions).toEqual([]);
    });
});
