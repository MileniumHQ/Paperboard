import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperConsole, PaperProvider, type PaperConsoleEntry } from "../../index";
import "../../styles/styles.css";

const CAP = 10_000;
const TYPES = ["output", "info", "warn", "error", "output", "output"] as const;

let next = 0;
// a mix of short lines, lines that wrap, and ANSI color, like a real server
function line(): PaperConsoleEntry {
    const i = next++;
    const wrap = i % 7 === 0 ? " the quick brown fox jumps over the lazy dog".repeat(6) : "";
    const ansi = i % 11 === 0 ? "\x1b[32mgreen\x1b[0m " : "";
    return { type: TYPES[i % TYPES.length], content: `${ansi}line ${i}${wrap}` };
}

function push(count: number) {
    setEntries((prev) => {
        const added = Array.from({ length: count }, line);
        const all = [...prev, ...added];
        return all.length > CAP ? all.slice(all.length - CAP) : all;
    });
}

const [entries, setEntries] = createSignal<PaperConsoleEntry[]>(Array.from({ length: CAP }, line));

const dispose = render(
    () => (
        <PaperProvider>
            <div style={{ display: "flex", "flex-direction": "column", height: "300px", width: "600px" }}>
                <PaperConsole showInput={false} entries={entries()} />
            </div>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

// a timer, not requestAnimationFrame: under --virtual-time-budget headless
// Chrome does not run animation frames
const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await frame();
};

const output = () => document.querySelector<HTMLElement>("[class*='outputArea']")!;
const rows = () => [...output().querySelectorAll<HTMLElement>("[class*='entry']:not([class*='entries'])")];
const atBottom = () => {
    const el = output();
    return el.scrollHeight - el.clientHeight - el.scrollTop < 2;
};
// the row under a point near the viewport's top edge, and where it sits
const topRow = () => {
    const box = output().getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 40, box.top + 5)?.closest<HTMLElement>("[class*='entry']");
    return hit ? { text: hit.textContent ?? "", top: hit.getBoundingClientRect().top } : null;
};
const newestVisible = (text: string) => {
    const box = output().getBoundingClientRect();
    const row = rows().find((r) => new RegExp(`${text}(?!\\d)`).test(r.textContent ?? ""));
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom <= box.bottom + 1 && rect.top >= box.top - 1;
};
const contiguous = () =>
    rows().every((row, i, all) => i === 0 || Math.abs(all[i - 1].getBoundingClientRect().bottom - row.getBoundingClientRect().top) < 1);

const checks: Record<string, unknown> = {};
(async () => {
    try {
        await frames(4);
        checks.windowed = rows().length < 200;
        checks.startsAtBottom = atBottom();
        checks.newestShown = newestVisible(`line ${next - 1}`);
        checks.contiguous = contiguous();

        // a burst of lines while following stays on the newest
        for (let i = 0; i < 300; i++) push(1);
        await frames(4);
        checks.followsBurst = atBottom() && newestVisible(`line ${next - 1}`);
        checks.windowedAfterBurst = rows().length < 200;

        // scroll into the middle: rows are there, not blank spacer
        const el = output();
        el.scrollTop = el.scrollHeight / 2;
        el.dispatchEvent(new Event("scroll"));
        await frames(4);
        const before = topRow();
        checks.middleFilled = before !== null;
        checks.middleContiguous = contiguous();

        // while reading, new lines (dropping old ones off the front) don't
        // move what's on screen
        for (let i = 0; i < 20; i++) {
            push(25);
            await frame();
        }
        await frames(4);
        const after = topRow();
        checks.readingHeld = Boolean(before && after && before.text === after.text && Math.abs(before.top - after.top) < 1);
        checks.notFollowing = !atBottom();

        // back at the bottom, following resumes
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event("scroll"));
        await frames(2);
        push(50);
        await frames(4);
        checks.followsAgain = atBottom() && newestVisible(`line ${next - 1}`);

        document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
    } catch (error) {
        document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
    } finally {
        dispose();
    }
})();
