// The run log in the editor (headless Chrome), over announcements as the
// daemon delivers them: each one a new list of new objects
// (test/helpers/panelFixture.ts).
import { expect, test } from "bun:test";
import { panelFixture } from "./helpers/panelFixture";

test(
    "a log line the service announces adds one row, the rows and selection already there stay, and the log follows new lines only while its reader is at the end",
    async () => {
        const { console: log } = await panelFixture();
        expect(log.rows).toBe(31);
        expect(log.newRowText).toBe("one more");
        // the 30 rows shown before are the same elements, not rebuilt
        expect(log.rowsKept).toBe(30);
        // what the reader had selected is still selected, in the page
        expect(log.selection).toBe("line 3");
        expect(log.selectionInPage).toBe(true);
        expect(log.startsAtEnd).toBeLessThanOrEqual(1);
        expect(log.followedAtEnd).toBeLessThanOrEqual(1);
        // lines arrived while the reader was at the top, who stayed there
        expect(log.stayedWhileReading).toBe(0);
        expect(log.followedAgain).toBeLessThanOrEqual(1);
        // a wrapped entry has its time on its first line
        expect(log.textLines).toBeGreaterThan(1);
        expect(log.timeTopMinusTextTop).toBeLessThanOrEqual(1);
    },
    180_000,
);
