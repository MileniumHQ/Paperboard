// The agent's computer before it is ready, in a real browser, over a stand-in
// agent whose computer is in each state in turn: not set up, setting up, and
// a setup that failed. Each state sits in the middle of the page, not in its
// top-left corner, and says what to do.
//
// Not over the real service: a setup is a download of Helium, which a test
// never reaches. What is checked here is the page's side: where each state is
// drawn.
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import type { Agent } from "../../src/lib/agent";
import ComputerView from "../../src/computer/ComputerView";
import { errors, frame, report, until } from "./chatPage";

const [state, setState] = createStore({ computer: { phase: "none", installed: false, steps: [] as unknown[], error: null as string | null, userControl: false } });
const agent = { state, name: () => "Ada", calls: { windows: async () => [] } } as unknown as Agent;

/** how far what the page shows sits from the middle of the view, in pixels: the box around everything with text in it that isn't as big as the view itself */
function offCenter(): { x: number; y: number } {
    const view = document.getElementById("app")!.firstElementChild!.getBoundingClientRect();
    const rects = [...document.querySelectorAll("#app *")]
        .filter((el) => el.textContent?.trim())
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.width < view.width - 4 && r.height < view.height - 4);
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: Math.round((left + right) / 2 - (view.left + view.width / 2)), y: Math.round((top + bottom) / 2 - (view.top + view.height / 2)) };
}

async function run(): Promise<Record<string, unknown>> {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <ComputerView agent={agent} />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    const offsets: Record<string, { x: number; y: number }> = {};
    const look = async (name: string, text: string) => {
        await until(`${name}: "${text}"`, () => document.body.innerText.includes(text));
        // the page has settled once a frame passes with nothing moving
        await frame();
        await frame();
        offsets[name] = offCenter();
    };

    await look("none", "Set up Ada's computer");
    const none = [...document.querySelectorAll("button")].map((b) => b.innerText.trim().split("\n").pop());

    setState("computer", { phase: "installing", steps: [{ id: "download", status: "running", percent: 40, bytes: { done: 160_000_000, total: 400_000_000 } }, { id: "unpack", status: "waiting" }] });
    await look("installing", "Downloading Helium");

    setState("computer", { phase: "failed", installed: false, error: "The download was interrupted", steps: [{ id: "download", status: "failed" }, { id: "unpack", status: "waiting" }] });
    await look("failed", "Couldn't set up the computer");
    const failed = [...document.querySelectorAll("button")].map((b) => b.innerText.trim().split("\n").pop());

    return { offsets, none, failed, uncaught: [...errors] };
}

report(run);
