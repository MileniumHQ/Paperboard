// The panel keeps what a person is doing while the service announces its
// state underneath (real browser): the whole panel, over the real service
// on a real daemon (test/fixtures/panelFixture.tsx). A refused call is one
// the service refuses for real (fixtures/wire.ts).
import { describe, expect, test } from "bun:test";
import { REFUSAL } from "./fixtures/world";
import { panelFixture } from "./helpers/panelFixture";
const TIMEOUT = 180_000;

describe("the editor", () => {
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
        "flows that couldn't be loaded leave the canvas read-only, say so until they load, and Try again loads them",
        async () => {
            const { loadFailure } = await panelFixture();
            expect(loadFailure.failed.text).toContain(REFUSAL);
            expect(loadFailure.failed.covers).toBe(true);
            expect(loadFailure.failed.toasted, "a toast said the flows that stay unloaded").toBe(false);
            expect(loadFailure.failed.readOnly).toBe(true);
            expect(loadFailure.failed.retryOnCanvas).toBe(true);
            expect(loadFailure.failed.library).toBe(false);
            expect(loadFailure.retried).toEqual({ readOnly: false, library: true });
        },
        TIMEOUT,
    );
});

