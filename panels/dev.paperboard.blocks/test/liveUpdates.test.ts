// The panel keeps what a person is doing while the service announces its
// state underneath (real browser): the whole panel, over the real service
// on a real daemon, which delivers every announcement as new objects
// (test/fixtures/panelFixture.tsx). A refused call is one the service
// refuses for real (fixtures/wire.ts). The log's rows are in console.test.ts.
import { describe, expect, test } from "bun:test";
import { LATE_NOT_SET_UP, REFUSAL } from "./fixtures/world";
// the switches' words (src/projects/state.ts, which runs only in a page)
const AUTO_START = "Auto-start";
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
        "Delete stays open while its toast keeps saying why it failed",
        async () => {
            const { dialogs } = await panelFixture();
            expect(dialogs.deleteError).toContain("Couldn't delete the project");
            expect(dialogs.deleteError).toContain(REFUSAL);
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
            expect(toggle.refused).toContain(REFUSAL);
            expect(toggle.noticeAfterRetry).toBeNull();
            // its words beside it say what it does, and flip it too
            expect(toggle.byLabel).toEqual({ label: AUTO_START, states: ["false", "true", "false"] });
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
        "says a panel's dropdown didn't load only in a project with its block on the canvas, however often the registry changes",
        async () => {
            const { refresh } = await panelFixture();
            expect(refresh.offCanvas).toBeNull();
            expect(refresh.onCanvas).toContain(LATE_NOT_SET_UP);
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
            // the page asks the service to drop it only while it still holds it as a draft, and only after the save:
            // the real service's state has said it is kept by the time the save answers, so it may not ask at all
            expect(leaving.keptSavedFirst).toBe(true);
            if (leaving.keptAsked !== undefined) expect(leaving.keptAsked).toEqual({ project: leaving.keptId, onlyDraft: true });
            expect(leaving.keptListed).toBe(true);
        },
        TIMEOUT,
    );

    test(
        "no edit is lost without a word: a refused save is said, Paperboard asks before a restart, and an editor that closes at once sends its last edit",
        async () => {
            const { unsavedWork: u } = await panelFixture();
            expect(u.askedBefore).toBe(false);
            expect(u.refused).toContain(REFUSAL);
            // asked before a restart while the save still fails: the person decides, and Stay keeps the panel
            expect(u.dialogText).toContain(REFUSAL);
            expect(u.stayAnswer).toBe(false);
            // asked once saves go through again: it is saved, and the panel may go
            expect(u.leaveAnswer).toBe(true);
            expect(u.afterSave).toEqual({ saved: true, notice: null, asks: false });
            // the window narrowed straight after an edit, before its save was due
            expect(u.sentOnClose).toBe(true);
            expect(u.onPhone).toContain(REFUSAL);
            expect(u.homeText).toContain(REFUSAL);
            expect(u.dismissed).toBe(true);
        },
        TIMEOUT,
    );

    test(
        "opening a project and leaving it without an edit saves nothing, so it isn't marked as just edited",
        async () => {
            const { opening } = await panelFixture();
            expect(opening.saves).toBe(0);
        },
        TIMEOUT,
    );

    test(
        "flows that couldn't be loaded leave the canvas read-only, say so until they load, and Try again loads them",
        async () => {
            const { loadFailure } = await panelFixture();
            expect(loadFailure.failed.text).toContain(REFUSAL);
            expect(loadFailure.failed.readOnly).toBe(true);
            expect(loadFailure.failed.retryOnCanvas).toBe(true);
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
            expect(home.failed).toContain(REFUSAL);
            expect(home.stayed).toBe(home.before);
            expect(home.banner).toContain("the registry is away");
            expect(home.after.moved).not.toBe(home.before);
            expect(home.after.switchFailure).toBeNull();
            expect(home.after.banner).toBeNull();
            // the card's switch has its words beside it, which flip it without opening the project
            expect(home.byLabel.label).toBe(AUTO_START);
            expect(home.byLabel.states).toEqual([home.after.moved, home.before, home.after.moved]);
            expect(home.stayedHome).toBe(true);
        },
        TIMEOUT,
    );
});
