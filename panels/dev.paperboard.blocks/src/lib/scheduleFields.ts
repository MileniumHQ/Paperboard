// The schedule hats' own parts on the canvas: a time typed as 9:5 reads
// 09:05 (one that isn't a time stays as it was), and a row under the hat
// that says when it next runs, which the editor fills from what the service
// announces. That row isn't saved; it is hidden until there is a time to say.
import * as Blockly from "blockly";
import { cleanTime } from "./schedule";

export const SCHEDULE_EXTENSION = "pb_schedule";
/** the label that says when the schedule next runs */
export const NEXT_RUN_FIELD = "NEXT_RUN";
/** the row it sits in */
export const NEXT_RUN_ROW = "NEXT_RUN_ROW";

if (!Blockly.Extensions.isRegistered(SCHEDULE_EXTENSION)) {
    Blockly.Extensions.register(SCHEDULE_EXTENSION, function (this: Blockly.Block) {
        this.getField("TIME")?.setValidator((text: string) => cleanTime(text));
        this.getInput(NEXT_RUN_ROW)?.setVisible(false);
    });
}

/** Shows when a schedule hat next runs, or hides the row with `null`. Not an edit: nothing is saved or undone. */
export function showNextRun(block: Blockly.Block, text: string | null): void {
    const row = block.getInput(NEXT_RUN_ROW);
    const label = block.getField(NEXT_RUN_FIELD);
    if (!row || !label) throw new Error(`${block.type} has no next-run row`);
    if ((text === null && !row.isVisible()) || (text !== null && row.isVisible() && label.getValue() === text)) return;
    Blockly.Events.disable();
    try {
        if (text !== null) label.setValue(text);
        row.setVisible(text !== null);
    } finally {
        Blockly.Events.enable();
    }
    if (block instanceof Blockly.BlockSvg && block.rendered) block.queueRender();
}

/** "Next run today at 04:00", as a schedule hat says it, in the viewer's own time. */
export function nextRunText(at: number, now = Date.now()): string {
    const date = new Date(at);
    // a schedule seconds apart says its seconds; one on the minute doesn't
    const time = date.toLocaleTimeString(undefined, { timeStyle: date.getSeconds() ? "medium" : "short" });
    if (at <= now) return "Runs any moment now";
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const days = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - midnight.getTime()) / 86_400_000 + 0.5);
    if (days === 0) return `Next run today at ${time}`;
    if (days === 1) return `Next run tomorrow at ${time}`;
    if (days < 7) return `Next run ${date.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
    return `Next run ${date.toLocaleDateString(undefined, { dateStyle: "medium" })} at ${time}`;
}

/** What a schedule hat says under it while its project's Auto-start is off. */
export const SCHEDULE_OFF = "Doesn't run while Auto-start is off";
