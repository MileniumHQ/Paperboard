// OpenCode's providers in the real settings over the real service
// (test/support/panel.ts), with OpenCode as the fake brain: its provider
// server (fakeBrain.mjs `serve`) knows Acme, which signs in on its page or
// takes a key, and Regional, whose endpoint is asked for only in the EU,
// where it starts. A sign-in's late answer never ends the sign-in that
// replaced it (the page's socket, test/support/wire.ts, holds that answer);
// the list read again keeps the provider's forms the ones they were; a
// sign-in OpenCode won't stop is told before the modal closes; and a field
// that depends on another's default is shown and needed.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { plan } from "./support/host";
import { bootPanel, openSection, type BootedPanel, type Page } from "./support/panel";
import { deliverAnswer, holdAnswers, sent, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "opencode" as const, model: null, compaction: "summarize" as const };
// as OpenCode's /api/integration lists them
const INTEGRATIONS = [
    {
        id: "acme",
        name: "Acme",
        methods: [
            { id: "browser", type: "oauth", label: "Sign in with Acme" },
            { type: "key", label: "Use an API key" },
        ],
        connections: [],
    },
    {
        id: "regional",
        name: "Regional",
        methods: [
            {
                type: "key",
                label: "Use an API key",
                form: [
                    { key: "region", title: "Region", type: "string", required: true, default: "eu", options: [{ value: "eu", label: "EU" }, { value: "us", label: "US" }] },
                    { key: "endpoint", title: "Endpoint", type: "string", required: true, when: [{ key: "region", op: "eq", value: "eu" }] },
                ],
            },
        ],
        connections: [],
    },
];
// the first sign-in is refused, by the time its answer arrives
const PLAN = { integrations: INTEGRATIONS, attempts: { attempt1: { status: "failed", message: "the first sign-in was refused" } } };

const MODAL = `[...document.querySelectorAll('[role=dialog]')].find((d) => d.innerText.includes("OpenCode providers"))`;
const button = (text: string) => `[...(${MODAL}?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const shows = (text: string) => `Boolean(${MODAL}?.innerText.includes(${JSON.stringify(text)}))`;
/** a failure toast, over the modal, that says `text` */
const toasted = (text: string) => `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].some((a) => a.innerText.includes(${JSON.stringify(text)}))`;
/** the menu named by its label, as a screen reader names it */
const TRIGGER = `[...(${MODAL}?.querySelectorAll('button[aria-haspopup="listbox"]') ?? [])].find((b) => document.getElementById((b.getAttribute("aria-labelledby") ?? "").split(" ")[0])?.textContent.trim() === "Provider")`;
/** types into a field as a keyboard does: the value changes, then the field says so */
const fill = (field: string, text: string) => `(() => { const el = ${field}; el.value = ${JSON.stringify(text)}; el.dispatchEvent(new InputEvent("input", { bubbles: true })); })()`;

let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, brainsOnPath: { opencode: { signedIn: false, chosen: true, plan: PLAN } } });
    page = await panel.open({ init: WIRE });
    await openSection(page, "Ada", "settings");
});
afterAll(() => panel?.close());

async function openProviders(): Promise<void> {
    const providers = `[...document.querySelector('[role=region][aria-label="Brains"]').querySelectorAll("button")].find((b) => b.innerText.includes("Providers"))`;
    await page.waitFor(providers, "OpenCode's Providers button");
    await page.evaluate(`${providers}.click()`);
    await page.waitFor(`${button("Connect")} || ${shows("Asking OpenCode")}`, "the providers modal");
}

async function choose(provider: string): Promise<void> {
    await page.waitFor(TRIGGER, "the provider menu");
    await page.evaluate(`${TRIGGER}.click()`);
    const option = `document.querySelector('[role=option][data-select-value="${provider}"]')`;
    await page.waitFor(option, `${provider} in the menu`);
    await page.evaluate(`${option}.click()`);
}

const attemptsAsked = async (id: string) => (await sent(page, "providerAttempt")).filter((a) => (a as { attempt: string }).attempt === id).length;

describe("a provider's sign-in", () => {
    test("canceled and started again: the first one's late failure doesn't end the new one; a key connected keeps the forms; closing over one that won't stop says so; a field depending on a default is needed", async () => {
        await openProviders();
        await choose("acme");
        // the first sign-in is asked about, and the answer takes its time
        await holdAnswers(page, "providerAttempt");
        await page.waitFor(button("Sign in"), "Sign in");
        await page.evaluate(`${button("Sign in")}.click()`);
        await page.waitFor(`window.__wireApi.heldAnswers("provider-attempt") === 1`, "the first sign-in's status answer");
        await holdAnswers(page, "providerAttempt", false);
        await page.evaluate(`${button("Cancel")}.click()`);
        await page.waitFor(`${button("Sign in")} && !${button("Sign in")}.disabled`, "Sign in, again");
        await page.evaluate(`${button("Sign in")}.click()`);
        await page.waitFor(shows("Sign-in 2"), "the second sign-in");

        // the first one's late answer: it failed
        const before = await attemptsAsked("attempt2");
        await deliverAnswer(page, "providerAttempt");
        // the second one is asked about again after it (the next poll), so the late answer has been handled by then; or it ended
        await page.waitFor(`window.__wireApi.sent("provider-attempt").filter((a) => a.attempt === "attempt2").length > ${before} || !${shows("Sign-in 2")}`, "the second sign-in's next status question, or its end");
        expect(await page.evaluate(`${shows("Sign-in 2")} && ${shows("Waiting for you to finish signing in")}`), "the new sign-in was ended").toBe(true);
        expect(await page.evaluate(`${shows("the first sign-in was refused")} || ${toasted("the first sign-in was refused")}`), "the old sign-in's error was shown").toBe(false);

        // a key connected: the list is read again, and the forms on show are the same nodes
        await page.evaluate(`${button("Cancel")}.click()`);
        await page.waitFor(`!${shows("Sign-in 2")}`, "the sign-in canceled");
        const keyField = `${MODAL}.querySelector('input[type="password"]')`;
        await page.waitFor(keyField, "the key's field");
        await page.evaluate(`(() => { window.__form = ${keyField}; window.__signIn = ${button("Sign in")}; })()`);
        await page.evaluate(fill(keyField, "sk-test"));
        await page.waitFor(`${button("Connect")} && !${button("Connect")}.disabled`, "Connect");
        await page.evaluate(`${button("Connect")}.click()`);
        await page.waitFor(shows("Acme key is connected."), "the list read again");
        expect(await page.evaluate(`window.__form.isConnected && window.__signIn.isConnected`), "the list read again rebuilt the provider's forms").toBe(true);

        // a sign-in under way, and OpenCode won't stop it: closing says so instead of hiding it
        plan(panel.fake, { ...PLAN, cancelRefuses: "OpenCode is busy" });
        await page.evaluate(`${button("Sign in")}.click()`);
        await page.waitFor(shows("Waiting for you to finish signing in"), "a sign-in");
        await page.evaluate(`${MODAL}.querySelector('button[aria-label="Close modal"]').click()`);
        await page.waitFor(toasted("OpenCode is busy"), "the refusal");
        expect(await page.evaluate(toasted("Couldn't stop signing in"))).toBe(true);
        expect(await page.evaluate(`Boolean(${MODAL})`), "the modal closed over a sign-in that wasn't stopped").toBe(true);
        // asked again, with nothing left signing in, it closes; opened again, nothing refused is left on it
        await page.evaluate(`${MODAL}.querySelector('button[aria-label="Close modal"]').click()`);
        await page.waitFor(`!${MODAL}`, "the modal closed");
        await openProviders();
        expect(await page.evaluate(shows("OpenCode is busy")), "an old refusal greets the modal opened again").toBe(false);

        // a provider whose endpoint depends on its region's default: asked for, and Connect waits for it
        await choose("regional");
        const regionalKey = `${MODAL}.querySelector('input[type="password"]')`;
        await page.waitFor(regionalKey, "Regional's key field");
        await page.evaluate(fill(regionalKey, "sk-test"));
        await page.waitFor(button("Connect"), "the key typed");
        expect(await page.evaluate(`${MODAL}.textContent.split("Regional").length - 1`), "the provider chosen was named again under its menu").toBe(1);
        expect(await page.evaluate(`${MODAL}.textContent.includes("Use an API key")`), "a provider's only way to connect was headed, over its own field").toBe(false);
        expect(await page.evaluate(`[...${MODAL}.querySelectorAll("label")].some((l) => l.textContent.includes("Endpoint"))`), "a field depending on a default wasn't shown").toBe(true);
        expect(await page.evaluate(`${button("Connect")}.disabled`), "Connect was offered without a needed field").toBe(true);
        expect(page.exceptions).toEqual([]);
    });
});
