// The real Agent panel (Main) on real PaperUI, over the fake service in
// agentsApi.ts, met for the first time: named, given Codex (installed and
// signed in), its default model and no computer yet, and then handed over
// to the chat. It reads the Name field's placeholder, where the sign-in
// card's line and buttons start, and every frame of the hand-over.
// Results are base64 JSON in #results.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Main from "../../src/Main";
import { service } from "./agentsApi";

const out = { checks: {} as Record<string, unknown>, error: "" };
const uncaught: string[] = [];
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// no agent yet; Codex is ready to think with
service.state.settings = null;
service.state.brains["codex"] = { ...service.state.brains["codex"], phase: "ready", installed: true, signedIn: true, account: "Logged in using ChatGPT", version: "0.166.0" };

render(() => <PaperProvider fullWidth fullHeight><Main /></PaperProvider>, document.getElementById("app")!);

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
// the innermost element that says exactly this
const saying = (text: string) => [...document.querySelectorAll<HTMLElement>("body *")].reverse().find((el) => el.textContent?.trim() === text);

async function until<T>(what: string, find: () => T | null | undefined | false, ms = 20_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const found = find();
        if (found) return found;
        if (Date.now() > end) throw new Error(`never: ${what}`);
        await sleep(50);
    }
}
const next = async (step: string) => (await until(`Next on ${step}`, () => (b => b && !b.disabled && b)(button("Next")))).click();

async function run() {
    const c = out.checks;
    // the name: its placeholder names what goes in it
    const name = await until("the Name field", () => document.querySelector<HTMLInputElement>("input"));
    c.namePlaceholder = name.placeholder;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Pip");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await next("the name");

    // the brain
    (await until("Codex to pick", () => saying("Codex"))).click();
    await next("the brain");

    // signed in: the line and the button under it start at the same edge
    const line = await until("the brain's line", () => [...document.querySelectorAll<HTMLElement>("p, span, div")].reverse().find((el) => /^\S.*Version 0\.166\.0\.$/.test(el.textContent?.trim() ?? "") && el.children.length === 0));
    const signOut = await until("Sign out", () => button("Sign out"));
    // where its words start, past any padding
    const words = document.createRange();
    words.selectNodeContents(line);
    c.lineLeft = Math.round(words.getBoundingClientRect().left);
    c.buttonLeft = Math.round(signOut.getBoundingClientRect().left);
    await next("signing in");

    // the model, then no computer yet
    (await until("the default model to pick", () => saying("Use Codex's default"))).click();
    await next("the model");
    (await until("Not yet to pick", () => saying("Not yet"))).click();
    await next("the computer");

    // the hand-over: the meeting fades out, then the chat fades in
    const finish = await until("Let's chat", () => (b => b && !b.disabled && b)(button("Let's chat")));
    finish.click();
    const seen: { meeting: number | null; chat: number | null }[] = [];
    const opacityOf = (el: Element | null | undefined) => {
        let o = 1;
        for (let e: Element | null | undefined = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o;
    };
    for (let i = 0; i < 90; i++) {
        await frame();
        const leaving = button("Let's chat");
        const chat = document.querySelector('button[aria-label="Menu"]');
        seen.push({ meeting: leaving ? opacityOf(leaving) : null, chat: chat ? opacityOf(chat) : null });
    }
    const meetingFrames = seen.filter((s) => s.meeting !== null).map((s) => s.meeting!);
    const chatFrames = seen.filter((s) => s.chat !== null).map((s) => s.chat!);
    c.meetingFaded = meetingFrames.some((o) => o > 0 && o < 1);
    c.chatFaded = chatFrames.some((o) => o > 0 && o < 1);
    c.chatSettled = chatFrames.at(-1) ?? null;
    c.neverBoth = seen.every((s) => s.meeting === null || s.chat === null);

    c.uncaught = uncaught;
}

run()
    .catch((e) => {
        out.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    })
    .finally(() => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify(out))))}`;
    });
