// The contract of the test panel's page and service: both import this file.
import { defineContract, shape } from "../../src/contract";

export const NOTES = "dev.test.notes";

const note = shape.object({ id: shape.text(), book: shape.text(), text: shape.text(), pinned: shape.boolean() });

export const notesContract = defineContract(NOTES, {
    // every call says which notebook it is about; the page's client is made for one
    scope: { book: shape.text() },
    calls: {
        addNote: { input: shape.object({ text: shape.text(), pinned: shape.optional(shape.boolean()) }), output: note },
        listNotes: { output: shape.list(note) },
        clear: { output: shape.nothing() },
        // how many times a handler ran, whatever it was given
        handlerRuns: { output: shape.number() },
        // a handler whose answer breaks its contract
        brokenAnswer: { output: note },
        // a handler that changes the state into what the contract doesn't allow
        brokenState: { output: shape.nothing() },
        // a handler that answers only once released: the page waits for it as long as the contract says
        held: { output: shape.nothing(), timeoutMs: 200 },
        release: { output: shape.nothing() },
        // the notebook's draft, kept in the keyed state under the notebook
        draft: { input: shape.object({ text: shape.text() }), output: shape.nothing() },
        discardDraft: { output: shape.nothing() },
        // a handler that keeps a draft its shape refuses
        brokenDraft: { output: shape.nothing() },
        // no one notebook's: the page calls it without the scope
        books: { output: shape.list(shape.text()), unscoped: true },
    },
    events: {
        noteAdded: note,
    },
    state: {
        shape: shape.object({ count: shape.number(), last: shape.nullable(shape.text()) }),
        initial: { count: 0, last: null },
    },
    keyed: {
        drafts: shape.object({ text: shape.text(), words: shape.number() }),
    },
});
