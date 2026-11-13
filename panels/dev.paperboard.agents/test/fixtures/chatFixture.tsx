// The real chat in a real browser: the chat holds itself at its end, or at
// the row being read, through every change of size, and only a browser lays
// anything out. The fixture mounts the chat over a service with a conversation
// and nothing else (paperapiStub.ts), then makes the sizes change the way they
// do in use (a bubble arrives, the message box grows) and reports where the
// chat was left, as JSON.
import { Show, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import Chat from "../../src/chat/Chat";
import { EVENTS, type ChatEntry } from "../../src/contract";
import { createFace } from "../../src/face/controller";
import { createAgent } from "../../src/lib/agent";
import { createLauncher } from "../../src/pages/launcher";
import { conversation, emit } from "./paperapiStub";

const errors: string[] = [];
window.addEventListener("error", (event) => errors.push(event.error instanceof Error ? event.error.message : event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until<T>(what: string, look: () => T | null | undefined | false): Promise<T> {
    const deadline = performance.now() + 15_000;
    for (;;) {
        const found = look();
        if (found) return found;
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await frame();
    }
}

/** Long enough for the chat to have been placed for a change: its observers run before a frame is painted. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await frame();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await frame();
}

const SAYINGS = [
    "Short one.",
    "A longer message that goes over a few lines in a narrow chat, the way an answer does when it explains what it found and what it would do next.",
    "First line\n\nsecond paragraph\n\nand a third one for good measure.",
];

/** A conversation that overflows the chat many times over, a minute apart so every bubble is its own group. */
function seed(count: number): ChatEntry[] {
    const start = Date.now() - count * 120_000;
    return Array.from({ length: count }, (_, i) => ({
        id: `seed${String(i).padStart(3, "0")}`,
        at: start + i * 120_000,
        kind: i % 2 ? "agent" : "user",
        text: `${i}. ${SAYINGS[i % SAYINGS.length]}`,
    }));
}

let arrived = 0;
/** The agent says something: the service tells every window. */
function arrive(text: string): string {
    const id = `new${String(++arrived).padStart(3, "0")}`;
    emit(EVENTS.entry, { id, at: Date.now(), kind: "agent", text });
    return id;
}

const list = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!.parentElement!;
const field = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Message"]:not([aria-hidden])')!;
const bubble = (id: string) => document.querySelector<HTMLElement>(`[data-message="${id}"]`);
/** how far the chat is from its end, in pixels */
const fromEnd = () => list().scrollHeight - list().scrollTop - list().clientHeight;

/** Types into the message box as a keyboard does: the field changes, then says so. */
function type(text: string): void {
    field().value = text;
    field().dispatchEvent(new InputEvent("input", { bubbles: true }));
}

/** The first row a reader sees at the top of the chat, and how far down the chat it sits. */
function topRow(): { id: string; offset: number } {
    const top = list().getBoundingClientRect().top;
    for (const row of document.querySelectorAll<HTMLElement>("[data-message]")) {
        const box = row.getBoundingClientRect();
        if (box.bottom > top) return { id: row.dataset.message!, offset: box.top - top };
    }
    throw new Error("no row is in view");
}
const offsetOf = (id: string) => bubble(id)!.getBoundingClientRect().top - list().getBoundingClientRect().top;

function Fixture() {
    const agent = createAgent();
    onCleanup(agent.dispose);
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);
    const pages = createLauncher(agent);
    return (
        <Show when={agent.hydration() === "ready"}>
            <div style={{ width: "420px", height: "640px", display: "flex" }}>
                <Chat agent={agent} face={face} pages={pages} onMenu={() => {}} />
            </div>
        </Show>
    );
}

async function run(): Promise<Record<string, unknown>> {
    conversation.push(...seed(150));
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Fixture />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    await until("the conversation", () => bubble("seed149"));
    await settle();
    const opened = { fromEnd: fromEnd(), overflows: list().scrollHeight > list().clientHeight * 3 };

    // someone at the end: a bubble arrives, and so does a tall one
    const short = arrive("On it.");
    await until("the bubble", () => bubble(short));
    await settle();
    const arrivedShort = { fromEnd: fromEnd(), shown: bubble(short)!.getBoundingClientRect().bottom <= list().getBoundingClientRect().bottom + 1 };
    const tall = arrive(Array.from({ length: 12 }, (_, i) => `line ${i} of a long answer`).join("\n\n"));
    await until("the tall bubble", () => bubble(tall));
    await settle();
    const arrivedTall = { fromEnd: fromEnd(), shown: bubble(tall)!.getBoundingClientRect().bottom <= list().getBoundingClientRect().bottom + 1 };

    // the message box grows as someone writes a long message, then shrinks as it is cleared
    const heightBefore = list().clientHeight;
    type(Array.from({ length: 8 }, (_, i) => `a line of the message ${i}`).join("\n"));
    await settle();
    const grown = { fromEnd: fromEnd(), listShrankBy: heightBefore - list().clientHeight };
    type("");
    await settle();
    const cleared = { fromEnd: fromEnd(), listRestored: list().clientHeight === heightBefore };

    // a reader who scrolled up to the middle: a bubble arrives below them
    list().scrollTop = (list().scrollHeight - list().clientHeight) / 2;
    await settle();
    const read = topRow();
    const readAt = list().scrollTop;
    const reading = arrive("Something new, below where they are reading.");
    await until("the bubble", () => bubble(reading));
    await settle();
    const whileArriving = { moved: offsetOf(read.id) - read.offset, away: fromEnd(), scrollMoved: list().scrollTop - readAt };

    // the same reader, and the message box grows under them
    type(Array.from({ length: 8 }, (_, i) => `a line of the message ${i}`).join("\n"));
    await settle();
    const whileGrowing = { moved: offsetOf(read.id) - read.offset, away: fromEnd() };
    type("");
    await settle();

    // the same reader goes up to the top: older rows are drawn above them, and what they read stays where it was
    list().scrollTop = 300;
    await settle();
    const top = topRow();
    const rowsBefore = document.querySelectorAll("[data-message]").length;
    list().scrollTop = 20;
    await settle();
    const reachedTop = {
        olderRowsDrawn: document.querySelectorAll("[data-message]").length - rowsBefore,
        // they moved 280 pixels up the chat, so the row is 280 pixels further down the view
        moved: offsetOf(top.id) - (top.offset + 280),
    };

    // and a reader scrolling back down to the end is held there again
    list().scrollTop = list().scrollHeight;
    await settle();
    const back = arrive("Welcome back.");
    await until("the bubble", () => bubble(back));
    await settle();
    const returned = { fromEnd: fromEnd(), shown: bubble(back)!.getBoundingClientRect().bottom <= list().getBoundingClientRect().bottom + 1 };

    return { opened, arrivedShort, arrivedTall, grown, cleared, whileArriving, whileGrowing, reachedTop, returned, uncaught: [...errors] };
}

run().then(
    (checks) => ({ checks, error: "" }),
    (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
).then((result) => fetch("/result", { method: "POST", body: JSON.stringify(result) }));
