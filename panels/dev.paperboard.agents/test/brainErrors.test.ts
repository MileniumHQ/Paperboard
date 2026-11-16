// Two brains' actions in the real settings over the real service
// (test/support/panel.ts): Codex in trouble (the program it was told to run
// is gone), Claude Code (the fake brain on PATH) in its sign-in, waiting for
// the code its page shows. What one brain's refusal says, and when, belongs
// to that brain alone. The page's socket (test/support/wire.ts) holds the
// code on its way while Codex's install is tried again and refused; the
// install is let through as one the real service refuses on this computer
// (a Codex found on it, and there is none), so nothing is downloaded.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, openSection, type BootedPanel, type Page } from "./support/panel";
import { holdCalls, releaseCall, sent, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "claude-code" as const, model: null, compaction: "summarize" as const };
const BRAINS = `document.querySelector('[role=region][aria-label="Brains"]')`;
const CLAUDE = `[...document.querySelectorAll('[role=dialog]')].find((d) => d.innerText.includes("Sign in to Claude"))`;
const alertsIn = (region: string) => `[...(${region}?.querySelectorAll("[role=alert]") ?? [])].map((a) => a.innerText)`;
// a refusal is a toast, over the settings and the sign-in alike: it names the brain it's about
const TOASTS = `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].map((a) => a.innerText)`;

let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        brainsOnPath: { "claude-code": { signedIn: false, chosen: true } },
        // Codex was told to run a program that has since gone: it stopped with a problem, and isn't installed
        seed: async (storage) => {
            const file = path.join(storage, "brains", "choices.json");
            fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), codex: path.join(storage, "gone", "codex") }));
        },
    });
    page = await panel.open({ init: WIRE });
    await openSection(page, "Ada", "settings");
    await page.waitFor(`${BRAINS}?.innerText.includes("Try again")`, "Codex's Try again");
});
afterAll(() => panel?.close());

test("a brain's button pressed twice before the service answers is sent once", async () => {
    // Claude Code's sign-in: its page is opened, and its code pasted and on its way
    await page.evaluate(`[...${BRAINS}.querySelectorAll("button")].find((b) => b.innerText.includes("Sign in")).click()`);
    await page.waitFor(`${CLAUDE}?.innerText.includes("Open sign-in page")`, "Claude Code's sign-in page");
    // what the button opens is the person's own browser's business: here, nothing
    await page.evaluate(`(() => { window.open = () => null; const a = [...${CLAUDE}.querySelectorAll("a")].find((b) => b.innerText.includes("Open sign-in page")); a.addEventListener("click", (e) => e.preventDefault()); a.click(); })()`);
    await page.waitFor(`${CLAUDE}?.querySelector("input")`, "Claude Code's code field");
    await holdCalls(page, "brainCode");
    await page.evaluate(`(() => {
        const paste = new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
        paste.clipboardData.setData("text", "abc-123");
        ${CLAUDE}.querySelector("input").dispatchEvent(paste);
    })()`);
    await page.waitFor(`window.__wireApi.heldCalls("brain-code") === 1 && !${CLAUDE}.querySelector("input")`, "the code to be on its way");

    // meanwhile Codex's install is tried again, pressed twice before the service answers, and refused
    await holdCalls(page, "installBrain");
    await page.evaluate(`(() => {
        const again = [...${BRAINS}.querySelectorAll("button")].find((b) => b.innerText.includes("Try again"));
        again.click();
        return new Promise((done) => requestAnimationFrame(() => { again.click(); done(); }));
    })()`);
    expect(await sent(page, "installBrain"), "the install was sent more than once").toEqual([{ harness: "codex" }]);
});

test("a refusal for one brain names that brain only, and doesn't undo the other brain's accepted code", async () => {
    await releaseCall(page, "installBrain", { from: "computer" });
    await page.waitFor(`${TOASTS}.some((a) => a.includes("Couldn't install Codex"))`, "Codex's refusal");
    const toasts = await page.evaluate<string[]>(TOASTS);
    expect(toasts.find((a) => a.includes("Couldn't install Codex"))).toContain("Codex isn't on this computer");
    expect(toasts.filter((a) => a.includes("Codex isn't on this computer")), "Codex's refusal is said other than once, about Codex").toHaveLength(1);
    expect(await page.evaluate(alertsIn(BRAINS)), "the refusal is an alert in the settings").toEqual([]);
    expect(await page.evaluate(alertsIn(CLAUDE)), "the refusal is an alert in Claude Code's sign-in").toEqual([]);

    // then the service takes the code: Claude Code finishes signing in, with no field to paste in again
    await releaseCall(page, "brainCode");
    await page.waitFor(`${CLAUDE}?.innerText.includes("Signed in")`, "Claude Code signed in");
    expect(await page.evaluate(`Boolean(${CLAUDE}.querySelector("input"))`), "the accepted code is asked for again").toBe(false);
    expect((await page.evaluate<string[]>(TOASTS)).filter((a) => a.includes("Couldn't sign in to Claude") || a.includes("didn't take the code"))).toEqual([]);
    expect(await sent(page, "installBrain")).toHaveLength(1);
    expect(page.exceptions).toEqual([]);
});
