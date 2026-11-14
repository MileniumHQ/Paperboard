// The run log in a real browser: lines arrive while the reader is at the end, then
// while they have scrolled up to read, and the log reports where it was left.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { Console } from "../../src/Console";
import type { LogEntry } from "../../src/panel";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
    for (let i = 0; i < 4; i++) await frame();
};

let nextId = 0;
const line = (message: string): LogEntry => ({ id: nextId++, at: Date.now(), level: "info", message, project: "p" });
const [entries, setEntries] = createSignal<LogEntry[]>(Array.from({ length: 30 }, (_, i) => line(`line ${i}`)));
const add = (message: string) => setEntries((all) => [...all, line(message)]);

render(
    () => (
        <PaperProvider>
            <Console entries={entries()} onClear={() => setEntries([])} />
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

async function run() {
    await settle();
    const body = document.querySelector<HTMLElement>("[class*=body]")!;
    const fromEnd = () => Math.round(body.scrollHeight - body.scrollTop - body.clientHeight);
    const checks: Record<string, unknown> = {};

    checks.startsAtEnd = fromEnd();
    add("while at the end");
    await settle();
    checks.followedAtEnd = fromEnd();

    // the reader scrolls up to read, and lines keep coming
    body.scrollTop = 0;
    await settle();
    add("while reading");
    add("while reading, again");
    await settle();
    checks.stayedWhileReading = body.scrollTop;

    // and comes back down: the log follows again
    body.scrollTop = body.scrollHeight;
    await settle();
    add("after coming back");
    await settle();
    checks.followedAgain = fromEnd();

    // a long entry wraps: its time sits on its first line
    add("a very long line ".repeat(30));
    await settle();
    const wrapped = [...document.querySelectorAll<HTMLElement>("[class*=line]")].at(-1)!;
    const time = wrapped.querySelector<HTMLElement>("[class*=time]")!.getBoundingClientRect();
    const text = wrapped.querySelector<HTMLElement>("[class*=text]")!.getBoundingClientRect();
    checks.timeTopMinusTextTop = Math.round(time.top - text.top);
    checks.textLines = Math.round(text.height / parseFloat(getComputedStyle(wrapped).lineHeight));
    return checks;
}

run().then(
    (checks) => fetch("/result", { method: "POST", body: JSON.stringify({ checks, error: "" }) }),
    (error) => fetch("/result", { method: "POST", body: JSON.stringify({ checks: {}, error: String(error) }) }),
);
