import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { fixture } from "./canvasSyncApi";

const root = document.getElementById("app")!;
const dispose = render(() => <PaperProvider><App /></PaperProvider>, root);
Object.assign(window, {
    canvasFixture: {
        fixture,
        dispose,
        checkLoadRetry() {
            const button = [...root.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry loading canvas"));
            if (!root.textContent?.includes("Canvas could not be loaded") || !button || button.disabled) throw new Error("Load failure has no recovery action");
            if (fixture.calls.length) throw new Error("Unreadable canvas was overwritten");
            fixture.failLoad = false;
            button.click();
        },
        checkRetry() {
            const status = root.querySelector('[role="status"]');
            const button = [...root.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry applying flows"));
            if (!status?.textContent?.includes("Canvas saved, but flows were not applied")) throw new Error("Apply failure is invisible");
            if (!button || button.disabled) throw new Error("No enabled retry action");
            fixture.failApply = false;
            button.click();
        },
        checkNotes() {
            if (fixture.saved?.notes?.[0]?.text !== "Keep this note") throw new Error("Loading the canvas erased the persisted note");
            return "Saved notes survived hydration and schema refresh";
        },
        checkPlay() {
            fixture.failApply = false;
            const play = root.querySelector<HTMLButtonElement>('button[title="Run On-Play Flows"]');
            if (!play) throw new Error("Play control missing");
            fixture.calls.length = 0;
            const note = root.querySelector<HTMLTextAreaElement>("textarea");
            if (!note) throw new Error("Saved note missing");
            note.value = "Pending edit";
            note.dispatchEvent(new Event("input", { bubbles: true }));
            play.click();
        },
    },
});
