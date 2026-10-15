// A window that opens per request answers only the opening that started the
// work: a save that outlives its opening cannot complete the next request.
import { expect, test } from "bun:test";
import { createOpenings } from "../src/renderer/src/lib/openings";

test("a late answer from a closed opening does not complete the next one", () => {
    const openings = createOpenings();
    const first = openings.open();
    // the first request closes; a second opens while its save is still in flight
    const second = openings.open();
    expect(openings.answer(first)).toBe(false);
    expect(openings.isCurrent(first)).toBe(false);
    expect(openings.answer(second)).toBe(true);
});

test("an opening is answered once", () => {
    const openings = createOpenings();
    const token = openings.open();
    expect(openings.answer(token)).toBe(true);
    expect(openings.answer(token)).toBe(false);
});
