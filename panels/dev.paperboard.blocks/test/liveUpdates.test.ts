// The panel keeps what a person is doing while the service announces its
// state underneath (real browser): the whole panel, over a service that
// delivers every announcement as new objects, as the daemon does
// (test/fixtures/panelFixture.tsx). The log's rows are in console.test.ts.
import { describe, expect, test } from "bun:test";
import { panelFixture } from "./helpers/panelFixture";
const TIMEOUT = 180_000;

describe("the project dialogs while the project list is announced again", () => {
    test(
        "Rename keeps the name being typed, and renames to it",
        async () => {
            const { dialogs } = await panelFixture();
            expect(dialogs.typed).toBe("Renamed by hand");
            expect(dialogs.renameKept).toBe("Renamed by hand");
            // what the field showed is what was saved, not the name it opened with
            expect(dialogs.renamedTo).toBe("Renamed by hand");
        },
        TIMEOUT,
    );

    test(
        "Delete keeps saying why it failed",
        async () => {
            const { dialogs } = await panelFixture();
            expect(dialogs.deleteError).toContain("Not deleted");
            expect(dialogs.deleteError).toContain("the disk is full");
        },
        TIMEOUT,
    );
});

describe("the Library", () => {
    test(
        "stays where it was scrolled to when a variable is made or renamed, and starts at the top for another category",
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

    test(
        "Create variable: the name field has the keyboard, and Enter makes one variable and closes the dialog",
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

describe("the editor", () => {
    test(
        "its switch moves with its thump once the service has switched the flows, and a refused flip is said until one goes through",
        async () => {
            const { toggle } = await panelFixture();
            expect(toggle.before).toBe("true");
            expect(toggle.after).toBe("false");
            expect(toggle.saved).toBe(false);
            expect(toggle.animated).toBe(true);
            expect(toggle.refused).toContain("the disk is full");
            expect(toggle.noticeAfterRetry).toBeNull();
        },
        TIMEOUT,
    );

    test(
        "shows the newest registry when two changes are answered in the other order",
        async () => {
            const { refresh } = await panelFixture();
            expect(refresh.lateShown).toBe(true);
        },
        TIMEOUT,
    );

    test(
        "saves the latest edit before it is left, and drops a new project left without a block",
        async () => {
            const { leaving } = await panelFixture();
            expect(leaving.savedBeforeHome).toBe(true);
            expect(leaving.savedBeforeMade).toBe(true);
            expect(leaving.emptyDraft).toBe(1);
            expect(leaving.droppedEmpty).toEqual({ project: leaving.emptyId, onlyDraft: true });
            expect(leaving.keptSavedFirst).toBe(true);
            expect(leaving.keptAsked).toEqual({ project: leaving.keptId, onlyDraft: true });
            expect(leaving.keptListed).toBe(true);
        },
        TIMEOUT,
    );

    test(
        "flows that couldn't be loaded leave the canvas read-only, say so until they load, and Try again loads them",
        async () => {
            const { loadFailure } = await panelFixture();
            expect(loadFailure.failed.text).toContain("the service is restarting");
            expect(loadFailure.failed.readOnly).toBe(true);
            expect(loadFailure.failed.dismissable).toBe(false);
            expect(loadFailure.failed.library).toBe(false);
            expect(loadFailure.retried).toEqual({ readOnly: false, library: true });
        },
        TIMEOUT,
    );
});

describe("the home screen", () => {
    test(
        "a switch that didn't move says why until a switch moves, and the service's banner goes once its trouble is over",
        async () => {
            const { home } = await panelFixture();
            expect(home.failed).toContain("the disk is full");
            expect(home.stayed).toBe(home.before);
            expect(home.banner).toContain("the registry is away");
            expect(home.after.moved).not.toBe(home.before);
            expect(home.after.switchFailure).toBeNull();
            expect(home.after.banner).toBeNull();
        },
        TIMEOUT,
    );
});
