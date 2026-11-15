// Two brains in a real browser, each with its status as the settings show
// it: Codex failed to install, Claude Code in the middle of its sign-in. The
// agent is a stand-in that holds each request until the fixture answers it.
// A refusal for one brain is told under that brain only, and a code the
// service took stays taken even when the other brain's request fails while
// the code is on its way.
import { For } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import type { BrainState, Harness } from "../../src/contract";
import type { Agent } from "../../src/lib/agent";
import { BrainButtons, BrainStatus, createBrainActions } from "../../src/settings/Brain";
import { errors, frame, report, until } from "./chatPage";

const brain = (b: Partial<BrainState>): BrainState => ({ phase: "none", installed: false, version: null, signedIn: false, account: null, percent: null, login: null, error: null, updateWaiting: false, existing: null, found: null, ...b });
const [brains] = createStore<Record<Harness, BrainState>>({
    codex: brain({ phase: "failed", error: "The download stopped." }),
    "claude-code": brain({ phase: "signing-in", installed: true, login: { url: null, code: null, expectsCode: true, callback: null } }),
    opencode: brain({}),
});

const held: Record<string, { resolve: () => void; reject: (e: Error) => void }> = {};
const hold = (name: string) => new Promise<void>((resolve, reject) => (held[name] = { resolve, reject }));
const agent = { state: { brains }, installBrain: () => hold("install"), brainCode: () => hold("code") } as unknown as Agent;

const region = (h: Harness) => document.querySelector<HTMLElement>(`[data-brain="${h}"]`)!;
const alerts = (h: Harness) => [...region(h).querySelectorAll<HTMLElement>("[role=alert]")].map((a) => a.innerText);

async function run(): Promise<Record<string, unknown>> {
    render(() => {
        const actions = createBrainActions(agent);
        return (
            <PaperProvider fullWidth fullHeight>
                <For each={["codex", "claude-code"] as Harness[]}>
                    {(h) => (
                        <div data-brain={h}>
                            <BrainStatus agent={agent} harness={h} actions={actions} />
                            <BrainButtons agent={agent} harness={h} actions={actions} onProviders={() => {}} />
                        </div>
                    )}
                </For>
            </PaperProvider>
        );
    }, document.getElementById("app")!);

    // Claude Code's code is pasted and on its way
    const code = await until("Claude Code's code field", () => region("claude-code").querySelector("input"));
    const paste = new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    paste.clipboardData!.setData("text", "abc-123");
    code.dispatchEvent(paste);
    await until("the code to be on its way", () => !region("claude-code").querySelector("input"));

    // meanwhile Codex's install is tried again and refused
    [...region("codex").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.innerText.includes("Try again"))!.click();
    held.install!.reject(new Error("No space left on the disk"));
    await until("Codex's refusal", () => alerts("codex").some((a) => a.includes("Codex not installed")));

    // then the service takes the code
    held.code!.resolve();
    await frame();
    await frame();
    return {
        codex: alerts("codex"),
        claude: alerts("claude-code"),
        // taken: Claude Code waits for its sign-in to finish, with no field to paste in again
        codeField: Boolean(region("claude-code").querySelector("input")),
        uncaught: [...errors],
    };
}

report(run);
