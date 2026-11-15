// The agent's computer in a real browser, over a stand-in agent that answers
// its calls here: using a window takes control of the computer, once; the
// idle wait hands it back; and so does closing the view while it's held.
// The idle wait runs on a clock the fixture moves, so nothing waits it out.
//
// Not over the real service: the computer is Helium, a download, and a real
// Chromium standing in for it would browse through the service's proxy to the
// public web, which a test never reaches. What is checked here is the page's
// side: when it asks for control, and when it hands it back.
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import type { ComputerWindow } from "../../src/contract";
import type { Agent } from "../../src/lib/agent";
import ComputerView, { IDLE_MS } from "../../src/computer/ComputerView";
import { errors, report, until } from "./chatPage";

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

const WINDOW: ComputerWindow = { id: 1, title: "Example", url: "https://example.com/", app: "browser", width: 800, height: 600 };
/** every take (true) and hand-back (false), in order */
const control: boolean[] = [];
const [state] = createStore({ computer: { phase: "ready", installed: true, steps: [], error: null, userControl: false } });
const agent = {
    state,
    name: () => "Ada",
    calls: {
        windows: async () => [structuredClone(WINDOW)],
        // a 1×1 GIF: the window's picture
        frame: async () => ({ same: false, hash: "h1", frame: "R0lGODlhAQABAAAAACw=", width: 800, height: 600, dialog: null }),
        go: async () => undefined,
        control: async (inputs: { take: boolean }) => void control.push(inputs.take === true),
    },
} as unknown as Agent;

const reload = () => document.querySelector<HTMLButtonElement>('button[aria-label="Reload"]')!;
const picture = () => document.querySelector<HTMLImageElement>('img[alt^="Example"]');
const held = () => picture()?.alt.endsWith("under your control") ?? false;

async function run(): Promise<Record<string, unknown>> {
    const dispose = render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <ComputerView agent={agent} />
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
