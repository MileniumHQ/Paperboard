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
            const button = [...root.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry saving"));
            if (!status?.textContent?.includes("Canvas saved, but flows were not applied")) throw new Error("Apply failure is invisible");
            if (!button || button.disabled) throw new Error("No enabled retry action");
            fixture.failApply = false;
            button.click();
        },
        checkNotes() {
            if (fixture.saved?.notes?.[0]?.text !== "Keep this note") throw new Error("Loading the canvas erased the persisted note");
            return "Saved notes survived hydration and schema refresh";
        },
        /** Another window saves a new note text; this window must show it. */
        remoteEdit(text: string) {
            const base = structuredClone(fixture.saved ?? fixture.initial);
            base.notes[0].text = text;
            fixture.saved = base;
            fixture.revision += 1;
            for (const cb of fixture.changed) cb({ revision: fixture.revision, clientId: "another-window" });
        },
        noteText() {
            return root.querySelector<HTMLTextAreaElement>("textarea")?.value ?? null;
        },
        /** An edit here on a stale revision is refused, then the latest shows. */
        staleEdit(localText: string, remoteText: string) {
            const note = root.querySelector<HTMLTextAreaElement>("textarea");
            if (!note) throw new Error("Saved note missing");
            // the other window saves without announcing yet, so this window's
            // next save is made on an older revision
            const base = structuredClone(fixture.saved ?? fixture.initial);
            base.notes[0].text = remoteText;
            fixture.saved = base;
            fixture.revision += 1;
            note.value = localText;
            note.dispatchEvent(new Event("input", { bubbles: true }));
        },
        statusText() {
            return root.querySelector('[role="status"]')?.textContent ?? "";
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
