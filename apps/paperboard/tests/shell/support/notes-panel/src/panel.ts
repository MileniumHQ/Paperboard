// The shell suite's editor: a note whose edits are unsaved until Save, and
// that asks, in its own dialog, whether to discard them before it goes.
import { setUnsavedChanges } from "@mileniumhq/paperapi";

const app = document.getElementById("app")!;
app.innerHTML = `
<textarea id="note" aria-label="Note"></textarea>
<button type="button" id="save">Save</button>
<div id="ask" role="dialog" aria-label="Unsaved changes" hidden>
    <p>Your note has unsaved changes.</p>
    <button type="button" id="discard">Discard</button>
    <button type="button" id="stay">Stay</button>
</div>`;
const ask = document.getElementById("ask")!;

const confirmLeave = () =>
    new Promise<boolean>((resolve) => {
        ask.hidden = false;
        const answer = (leave: boolean) => () => {
            ask.hidden = true;
            resolve(leave);
        };
        document.getElementById("discard")!.onclick = answer(true);
        document.getElementById("stay")!.onclick = answer(false);
    });

document.getElementById("note")!.addEventListener("input", () => setUnsavedChanges(confirmLeave));
document.getElementById("save")!.addEventListener("click", () => setUnsavedChanges(null));
