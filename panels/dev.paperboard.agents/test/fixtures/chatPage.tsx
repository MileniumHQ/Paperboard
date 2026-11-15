// What the chat's browser fixtures share: the real chat mounted over the
// stubbed service (paperapiStub.ts), ways to wait for it and type into it,
// and the result posted back to the test as JSON.
import { Show, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import Chat from "../../src/chat/Chat";
import { createFace } from "../../src/face/controller";
import { createAgent } from "../../src/lib/agent";
import { createLauncher } from "../../src/pages/launcher";

/** what the page threw and didn't catch; as PaperUI's error toast, not the browser's own notes (a ResizeObserver that ran over), which carry no error */
export const errors: string[] = [];
window.addEventListener("error", (event) => event.error != null && errors.push(event.error instanceof Error ? event.error.message : String(event.error)));
window.addEventListener("unhandledrejection", (event) => errors.push(event.reason instanceof Error ? event.reason.message : String(event.reason)));

export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function until<T>(what: string, look: () => T | null | undefined | false): Promise<T> {
    const deadline = performance.now() + 15_000;
    for (;;) {
        const found = look();
        if (found) return found;
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await frame();
    }
}

export const field = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Message"]:not([aria-hidden])')!;

/** Types into the message box as a keyboard does: the field changes, then says so. */
export function type(text: string): void {
    field().value = text;
    field().dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function Fixture(props: { width: string; height: string }) {
    const agent = createAgent();
    onCleanup(agent.dispose);
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);
    const pages = createLauncher(agent);
    return (
        <Show when={agent.hydration() === "ready"}>
            <div style={{ width: props.width, height: props.height, display: "flex" }}>
                <Chat agent={agent} face={face} pages={pages} onMenu={() => {}} />
            </div>
        </Show>
    );
}

/** Mounts the chat at that size, over whatever conversation the stub has now. */
export function mountChat(width: string, height: string): void {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Fixture width={width} height={height} />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
}

/** Runs the fixture and posts what it found (or why it couldn't) to the test. */
export function report(run: () => Promise<Record<string, unknown>>): void {
    run()
        .then(
            (checks) => ({ checks, error: "" }),
            (err: unknown) => ({ checks: {}, error: `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\nuncaught: ${JSON.stringify(errors)}` }),
        )
        .then((result) => fetch("/result", { method: "POST", body: JSON.stringify(result) }));
}
