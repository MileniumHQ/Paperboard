import "@paperboard-dev/paperui/style.css";
import "./shell.css";
import "./screenshot.css";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { PaperProvider, PaperButton } from "@paperboard-dev/paperui";

declare global {
    interface Window {
        screenshotTool: {
            resize(width: number, height: number): Promise<{ message: string }>;
            save(scale: number): Promise<{ message: string }>;
        };
    }
}

function ScreenshotController() {
    const [width, setWidth] = createSignal("1440");
    const [height, setHeight] = createSignal("900");
    const [scale, setScale] = createSignal("1");
    const [busy, setBusy] = createSignal(false);
    const [message, setMessage] = createSignal("Navigate in the Paperboard window, then save a PNG.");
    const run = async (operation: () => Promise<{ message: string }>) => {
        setBusy(true);
        try {
            setMessage((await operation()).message);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };
    return <PaperProvider fullWidth fullHeight>
        <main class="screenshot-controller">
            <h1>Screenshot</h1>
            <form onSubmit={(event) => {
                event.preventDefault();
                void run(() => window.screenshotTool.resize(Number(width()), Number(height())));
            }}>
                <div class="screenshot-dimensions">
                    <label>Width (px)<input type="number" min="320" max="3840" step="1" required value={width()} disabled={busy()} onInput={(e) => setWidth(e.currentTarget.value)} /></label>
                    <label>Height (px)<input type="number" min="240" max="2160" step="1" required value={height()} disabled={busy()} onInput={(e) => setHeight(e.currentTarget.value)} /></label>
                </div>
                <PaperButton type="submit" disabled={busy()}>Resize viewport</PaperButton>
            </form>
            <label>Output scale (×)<input type="number" min="0.25" max="4" step="0.25" value={scale()} disabled={busy()} onInput={(e) => setScale(e.currentTarget.value)} /></label>
            <PaperButton disabled={busy()} onClick={() => void run(() => window.screenshotTool.save(Number(scale())))}>Save screenshot…</PaperButton>
            <p role="status" aria-live="polite">{message()}</p>
        </main>
    </PaperProvider>;
}

render(() => <ScreenshotController />, document.getElementById("root")!);
