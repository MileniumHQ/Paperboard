// The panel keeps what a person is doing while the service announces its
// state underneath (real browser): the whole panel, over a service that
// delivers every announcement as new objects, as the daemon does
// (test/fixtures/panelFixture.tsx). The log's rows are in console.test.ts.
//
// Without Chrome these are skipped with a visible reason; CI must have it.
import { describe, expect, test } from "bun:test";
import { browserTest, chrome, panelFixture } from "./helpers/panelFixture";

const liveTest = chrome ? test : test.skip;
const TIMEOUT = 180_000;

describe("the project dialogs while the project list is announced again", () => {
    liveTest(
        browserTest("Rename keeps the name being typed, and renames to it"),
        async () => {
            const { dialogs } = await panelFixture();
            expect(dialogs.typed).toBe("Renamed by hand");
            expect(dialogs.renameKept).toBe("Renamed by hand");
            // what the field showed is what was saved, not the name it opened with
            expect(dialogs.renamedTo).toBe("Renamed by hand");
        },
        TIMEOUT,
    );

    liveTest(
        browserTest("Delete keeps saying why it failed"),
        async () => {
            const { dialogs } = await panelFixture();
            expect(dialogs.deleteError).toContain("Not deleted");
            expect(dialogs.deleteError).toContain("the disk is full");
        },
        TIMEOUT,
    );
});

describe("the Library", () => {
    liveTest(
        browserTest("stays where it was scrolled to when a variable is made or renamed, and starts at the top for another category"),
        async () => {
            const { library } = await panelFixture();
            // the list was scrolled away from its start
            expect(library.scrolledY).not.toBe(library.startY);
            expect(library.afterCreate).toBe(library.scrolledY);
            expect(library.afterRename).toBe(library.scrolledY);
            expect(library.otherCategory).toBe(library.startY);
            expect(library.backAgain).toBe(library.startY);
        },
        TIMEOUT,
    );

    liveTest(
        browserTest("Create variable: the name field has the keyboard, and Enter makes one variable and closes the dialog"),
        async () => {
            const { createVariable } = await panelFixture();
            expect(createVariable.focusedOnOpen).toBe(true);
            expect(createVariable.made).toBe(1);
            expect(createVariable.added).toBe(1);
            expect(createVariable.dialogOpen).toBe(false);
        },
        TIMEOUT,
    );
});
