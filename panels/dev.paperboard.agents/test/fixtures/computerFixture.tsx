// The agent's computer in a real browser, over the stubbed service
// (paperapiStub.ts): using a window takes control of the computer, once; the
// idle wait hands it back; and so does closing the view while it's held.
// The idle wait runs on a clock the fixture moves, so nothing waits it out.
import { Show, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import { UI_ACTION_IDS, type ComputerWindow } from "../../src/contract";
import { createAgent } from "../../src/lib/agent";
import ComputerView, { IDLE_MS } from "../../src/computer/ComputerView";
import { errors, report, until } from "./chatPage";
import { answers, state } from "./paperapiStub";

// the idle hand-back's timer is held, to be run when the fixture says; every other timer runs as it would
const idle = new Map<number, () => void>();
let fakeIds = 1e9;
const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
window.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms !== IDLE_MS) return realSetTimeout(fn, ms, ...rest);
    const id = ++fakeIds;
    idle.set(id, fn);
    return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => (id !== undefined && idle.delete(id) ? undefined : realClearTimeout(id))) as typeof window.clearTimeout;
const goIdle = () => {
    const due = [...idle.values()];
    idle.clear();
    due.forEach((fn) => fn());
};

state.computer = { phase: "ready", installed: true, steps: [], error: null, userControl: false };
const WINDOW: ComputerWindow = { id: 1, title: "Example", url: "https://example.com/", app: "browser", width: 800, height: 600 };
/** every take (true) and hand-back (false), in order */
const control: boolean[] = [];
answers.set(UI_ACTION_IDS.windows, async () => ({ windows: [structuredClone(WINDOW)] }));
// a 1×1 GIF: the window's picture
answers.set(UI_ACTION_IDS.frame, async () => ({ same: false, hash: "h1", frame: "R0lGODlhAQABAAAAACw=", width: 800, height: 600, dialog: null }));
answers.set(UI_ACTION_IDS.go, async () => ({}));
answers.set(UI_ACTION_IDS.control, async (inputs) => {
    control.push(inputs.take === true);
    return { userControl: inputs.take === true };
});

const reload = () => document.querySelector<HTMLButtonElement>('button[aria-label="Reload"]')!;
const picture = () => document.querySelector<HTMLImageElement>('img[alt^="Example"]');
const held = () => picture()?.alt.endsWith("under your control") ?? false;

function Fixture() {
    const agent = createAgent();
    onCleanup(agent.dispose);
    return (
        <Show when={agent.hydration() === "ready"}>
            <ComputerView agent={agent} />
        </Show>
    );
}

async function run(): Promise<Record<string, unknown>> {
    const dispose = render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Fixture />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    await until("the window's picture", () => picture()).catch((e) => {
        throw new Error(`${e.message}: ${document.body.innerText}`);
    });

    // used twice: taken once, and shown as taken
    reload().click();
    await until("control taken", () => held());
    reload().click();
    await until("the second use", () => idle.size === 1 && control.length === 1);
    const takenOnce = [...control];

    // idle: handed back, and shown as the computer's again
    goIdle();
    await until("control handed back", () => !held() && control.length === 2);
    const afterIdle = [...control];

    // taken again, then the view closes while it's held: handed back
    reload().click();
    await until("control taken again", () => held());
    dispose();
    await until("the hand-back on close", () => control.length === 4);

    return { takenOnce, afterIdle, all: [...control], idleLeft: idle.size, uncaught: [...errors] };
}

report(run);
