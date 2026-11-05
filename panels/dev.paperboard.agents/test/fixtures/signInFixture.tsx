// Signing in to a brain from settings (SignInModal on real PaperUI), with the
// service's state driven by hand: the modal shows one step at a time, the
// address a browser comes back to is caught by the shell on this device and
// sent on, a web browser gets a field to paste it into, a brain that asks for
// a code gets a code field, and closing the modal stops the sign-in.
// Results are base64 JSON in #results.
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { DEFAULT_STATE, type AiState, type Harness, type LoginPrompt } from "../../src/contract";
import type { Agent } from "../../src/lib/agent";
import { SignInModal, createBrainActions } from "../../src/settings/Brain";
import { LoopbackRedirectError, loopback } from "./agentsApi";

const out = { checks: {} as Record<string, unknown>, error: "" };
const uncaught: string[] = [];
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const [state, setState] = createStore<AiState>(structuredClone(DEFAULT_STATE));
const calls: { id: string; input?: unknown }[] = [];
const agent = {
    state,
    signInBrain: async (harness: Harness) => {
        calls.push({ id: "signIn", input: harness });
        setState("brains", harness, { phase: "signing-in", login: null, error: null });
    },
    brainCode: async (harness: Harness, code: string) => void calls.push({ id: "code", input: [harness, code] }),
    brainAddress: async (harness: Harness, address: string) => void calls.push({ id: "address", input: [harness, address] }),
    cancelBrainSignIn: async (harness: Harness) => {
        calls.push({ id: "cancel", input: harness });
        setState("brains", harness, { phase: "installed", login: null });
    },
} as unknown as Agent;
const actions = createBrainActions(agent);
const [open, setOpen] = createSignal<Harness | null>(null);

render(() => <PaperProvider fullWidth fullHeight><SignInModal agent={agent} harness={open()} actions={actions} onClose={() => setOpen(null)} /></PaperProvider>, document.getElementById("app")!);

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const text = () => dialog()?.textContent ?? "";
const control = (label: string) =>
    [...(dialog()?.querySelectorAll<HTMLElement>("a, button") ?? [])].find((b) => b.textContent?.replace(/open_in_new/g, "").trim() === label);
const field = (label: string) => [...(dialog()?.querySelectorAll("label") ?? [])].find((l) => l.textContent?.trim() === label)?.parentElement?.querySelector("input") ?? null;
const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
};
const login = (harness: Harness, prompt: LoginPrompt) => setState("brains", harness, { login: prompt });
const CODEX_PAGE = "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=s";
const CALLBACK = "http://127.0.0.1:1455/auth/callback";

async function run() {
    const c = out.checks;
    for (const h of ["codex", "claude-code"] as Harness[]) setState("brains", h, { phase: "installed", installed: true });

    // Codex, on another computer, from the desktop app: the shell catches the browser's return
    let caught!: (url: string) => void;
    loopback.answer = () => new Promise((resolve) => (caught = (url) => resolve({ status: "caught", url })));
    setOpen("codex");
    await sleep(300);
    c.startsSignIn = calls.some((x) => x.id === "signIn" && x.input === "codex");
    c.waitsForPage = text().includes("Getting Codex's sign-in page");
    login("codex", { url: CODEX_PAGE, code: null, expectsCode: false, callback: CALLBACK });
    await sleep(200);
    const go = control("Continue in your browser");
    c.continueOpensPage = go?.getAttribute("href") === CODEX_PAGE && go?.getAttribute("target") === "_blank";
    c.oneStepAtATime = !text().includes("Waiting for you");
    c.askedShell = loopback.asked.at(-1) === CALLBACK;
    // the page opens in a new tab; the click is what moves the modal on
    go?.addEventListener("click", (e) => e.preventDefault(), { once: true });
    go?.click();
    await sleep(200);
    c.waitsAfterContinue = text().includes("Waiting for you to finish signing in") && !control("Continue in your browser");
    c.noPasteFieldWhenCaught = field("Address") === null;
    caught("http://127.0.0.1:1455/auth/callback?code=c&state=s");
    await sleep(100);
    c.sentCaughtAddress = JSON.stringify(calls.find((x) => x.id === "address")?.input) === JSON.stringify(["codex", "http://127.0.0.1:1455/auth/callback?code=c&state=s"]);
    setState("brains", "codex", { phase: "ready", signedIn: true, account: "pip@example.com", login: null });
    await sleep(200);
    c.signedInAs = text().includes("Signed in as pip@example.com.") && Boolean(control("Done"));
    control("Done")!.click();
    await sleep(400);
    c.doneCloses = dialog() === null && !calls.some((x) => x.id === "cancel");

    // Codex from a web browser: there's no listener here, so the address is pasted
    setState("brains", "codex", { phase: "installed", signedIn: false, account: null });
    loopback.answer = () => Promise.reject(new LoopbackRedirectError("unavailable", "Catching a redirect needs the Paperboard app"));
    calls.length = 0;
    setOpen("codex");
    await sleep(200);
    login("codex", { url: CODEX_PAGE, code: null, expectsCode: false, callback: CALLBACK });
    await sleep(200);
    control("Continue in your browser")?.addEventListener("click", (e) => e.preventDefault(), { once: true });
    control("Continue in your browser")?.click();
    await sleep(200);
    const address = field("Address");
    c.pasteFieldInBrowser = address !== null;
    c.noWarningForBrowser = !dialog()?.querySelector('[class*="warning"]') && !text().includes("can't come back");
    type(address!, "  http://127.0.0.1:1455/auth/callback?code=p&state=s ");
    await sleep(50);
    control("Continue")!.click();
    await sleep(100);
    c.sentPastedAddress = JSON.stringify(calls.find((x) => x.id === "address")?.input) === JSON.stringify(["codex", "http://127.0.0.1:1455/auth/callback?code=p&state=s"]);

    // closing before it's done stops the sign-in
    control("Cancel")!.click();
    await sleep(400);
    c.cancelStops = calls.some((x) => x.id === "cancel" && x.input === "codex") && dialog() === null;

    // a port already taken on this device is said, and the field is there
    setState("brains", "codex", { phase: "installed" });
    loopback.answer = () => Promise.reject(new LoopbackRedirectError("in-use", "Port 1455 is already in use on this device"));
    setOpen("codex");
    await sleep(200);
    login("codex", { url: CODEX_PAGE, code: null, expectsCode: false, callback: CALLBACK });
    await sleep(200);
    control("Continue in your browser")?.addEventListener("click", (e) => e.preventDefault(), { once: true });
    control("Continue in your browser")?.click();
    await sleep(200);
    c.inUseSaid = text().includes("Port 1455 is already in use on this device") && field("Address") !== null;
    control("Cancel")!.click();
    await sleep(400);

    // Claude's page ends in a code, pasted back; there's no address to catch
    loopback.asked.length = 0;
    calls.length = 0;
    setOpen("claude-code");
    await sleep(200);
    login("claude-code", { url: "https://claude.com/cai/oauth/authorize?code=true", code: null, expectsCode: true, callback: null });
    await sleep(200);
    control("Continue in your browser")?.addEventListener("click", (e) => e.preventDefault(), { once: true });
    control("Continue in your browser")?.click();
    await sleep(200);
    const codeField = field("Code");
    c.codeFieldForClaude = codeField !== null && field("Address") === null && loopback.asked.length === 0;
    type(codeField!, "abc#def");
    await sleep(50);
    control("Continue")!.click();
    await sleep(100);
    c.sentCode = JSON.stringify(calls.find((x) => x.id === "code")?.input) === JSON.stringify(["claude-code", "abc#def"]);
    // a failed sign-in is said in the modal, with a way to try again
    setState("brains", "claude-code", { phase: "failed", error: "The Claude sign-in ended (exit 1)", login: null });
    await sleep(200);
    c.failureShown = Boolean(dialog()?.querySelector('[role="alert"]')?.textContent?.includes("The Claude sign-in ended (exit 1)")) && Boolean(control("Try again"));

    c.uncaught = uncaught;
}

run()
    .catch((e) => {
        out.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    })
    .finally(() => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
    });
