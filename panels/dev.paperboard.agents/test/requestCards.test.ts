// The chat's request cards in a real browser over the real service
// (test/support/panel.ts): the agent (Codex, the fake brain) asks for a key
// with ask_user and for access with request_access, and the cards are
// answered as a person would. Each answer is sent once however often it's
// pressed, a typed key is gone from the page once the card is answered, and
// an answer that didn't go through says why in a toast (it isn't the card's
// record: the request is still waiting). The page's socket
// (test/support/wire.ts) holds an answer on its way, and lets one go to a
// request that isn't waiting, so the real service refuses it.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import os from "node:os";
import { runBrowserFixture } from "./browserFixture";
import { bootPanel, type BootedPanel, type Page } from "./support/panel";
import { holdCalls, releaseCall, sent, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const KEY = "lin_api_secret-key";
const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const LINEAR = { name: "linear", where: "host", transport: "stdio", command: "/bin/false", args: [], env: { LINEAR_KEY: { secret: "api-key" } }, enabled: false };
const FOLDER = os.tmpdir();
// the cards, by name
const PROMPT = "Connect Linear";
const ACCESS = "Ada requests permission";
// what the agent asks for in its turn
const ASK = [
    { name: "ask_user", arguments: { title: PROMPT, reason: "To read your issues.", fields: [{ label: "Workspace" }, { label: "API key", secret: { server: "linear", name: "api-key" } }] } },
    { name: "request_access", arguments: { reason: ACCESS, items: [{ kind: "folder", path: FOLDER }] } },
];
const FIELD = 'textarea[aria-label^="Message"]:not([aria-hidden])';

/** the request card in the chat named `name` */
const card = (name: string) => `document.querySelector(${JSON.stringify(`[role=region][aria-label="${name}"][data-message]`)})`;

const button = (inCard: string, text: string) => `[...${card(inCard)}.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(text)})`;
const alertIn = (inCard: string) => `(${card(inCard)}.querySelector("[role=alert]")?.innerText ?? null)`;
const TOAST = `(document.querySelector("[data-paper-toasts] [role=alert]")?.innerText ?? null)`;
/** types into a card's field as a keyboard does: the value changes, then the field says so */
const fill = (inCard: string, name: string, text: string) => `(() => {
    const input = ${card(inCard)}.querySelector('input[name="${name}"]');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
})()`;
/** anywhere the page still holds `secret`: a field's value or its text */
const holds = (secret: string) => `document.body.innerHTML.includes(${JSON.stringify(secret)}) || [...document.querySelectorAll("input")].some((i) => i.value.includes(${JSON.stringify(secret)}))`;

let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, tools: { actions: false, servers: [LINEAR] }, codexOnPath: { signedIn: true, chosen: true, plan: { ask: ASK } } });
    page = await panel.open({ init: WIRE });
    await page.type(FIELD, "Connect Linear and fix the build [[ask]]");
    await page.waitFor(`!document.querySelector('button[aria-label="Send"]').disabled`, "Send to be ready");
    await page.click('button[aria-label="Send"]');
    await page.waitFor(`${card(PROMPT)}?.querySelector('input[name="prompt-1"]') && ${card(ACCESS)}`, "the agent's two requests");
});
afterAll(() => panel?.close());

describe("a request card in the chat", () => {
    // over a stand-in agent (fixtures/signInCard.tsx says why)
    test("a sign-in pressed twice is sent once; refused, it says why and the typed password is gone", async () => {
        const { checks, error } = await runBrowserFixture("test/fixtures/signInCard.html");
        expect(error, "the fixture threw").toBe("");
        expect(checks.sends, "the sign-in was sent more than once").toBe(1);
        expect(checks.values).toEqual(["ada@example.com", "correct horse battery staple"]);
        expect(checks.refusal).toContain("Couldn't send your answer");
        expect(checks.refusal).toContain("The browser window closed");
        expect(checks.inCard, "the refusal is an alert on the card").toBeNull();
        expect(checks.holdsPassword, "the password is still on the page").toBe(false);
        expect(checks.uncaught).toEqual([]);
    });

    test("a prompt pressed twice is sent once, and once it's sent the key is nowhere on the page", async () => {
        await holdCalls(page, "answerPrompt");
        await page.evaluate(fill(PROMPT, "prompt-0", "acme"));
        await page.evaluate(fill(PROMPT, "prompt-1", KEY));
        await page.waitFor(`!${button(PROMPT, "Send")}.disabled`, "Send to be ready");
        await page.evaluate(`(() => { const send = ${button(PROMPT, "Send")}; send.click(); send.click(); })()`);
        const asked = (await sent(page, "answerPrompt")) as { values: string[] }[];
        expect(asked, "the prompt was sent more than once").toHaveLength(1);
        expect(asked[0]!.values).toEqual(["acme", KEY]);
        await releaseCall(page, "answerPrompt");
        await page.waitFor(`${card(PROMPT)}.innerText.includes("Keys are saved for linear")`, "the prompt to say it was sent");
        expect(await page.evaluate(holds(KEY)), "the key is still on the page").toBe(false);
        await holdCalls(page, "answerPrompt", false);
        expect(page.exceptions).toEqual([]);
    });

    test("an access request's refused answer says why, and a decline that goes through says so in place of the buttons", async () => {
        await holdCalls(page, "answerAccess");
        await page.evaluate(`${button(ACCESS, "Always allow")}.click()`);
        await page.waitFor(`window.__wireApi.heldCalls("answer-access") === 1`, "the answer on its way");
        expect(((await sent(page, "answerAccess")) as { how: string }[])[0]!.how).toBe("always");
        // it reaches the service for a request that isn't waiting: the service refuses it
        await releaseCall(page, "answerAccess", { id: "0000000000000000" });
        await page.waitFor(TOAST, "the access answer's refusal");
        const refusal = await page.evaluate<string>(TOAST);
        expect(refusal).toContain("Couldn't send your answer");
        expect(refusal).toContain("That request isn't waiting anymore.");
        expect(await page.evaluate(alertIn(ACCESS)), "the refusal is an alert on the card").toBeNull();
        await page.click('[data-paper-toasts] [aria-label="Close"]');
        await page.waitFor(`${TOAST} === null`, "the refusal's toast to close");
        await holdCalls(page, "answerAccess", false);
        await page.evaluate(`${button(ACCESS, "Decline")}.click()`);
        await page.waitFor(`${card(ACCESS)}.innerText.includes("You said no.")`, "the access request to say no");
        expect(await page.evaluate(`${alertIn(ACCESS)} ?? ${TOAST}`), "the old refusal is still shown").toBeNull();
        expect(await page.evaluate(`[...${card(ACCESS)}.querySelectorAll("button")].filter((b) => /allow|decline/i.test(b.innerText)).length`), "the answer buttons are still shown").toBe(0);
        expect(page.exceptions).toEqual([]);
    });
});
