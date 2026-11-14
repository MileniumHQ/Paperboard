import { afterEach, describe, expect, test } from "vitest";
import { createRoot } from "solid-js";
import { MOBILE_ATTRIBUTE, createPaperMobile, paperMobile, setPaperMobile } from "../utils/mobileMode";

// Inventory: mobile mode is the host's fact; a host that never said is the desktop, and a garbled value is an error.
describe("mobile mode", () => {
    afterEach(() => document.documentElement.removeAttribute(MOBILE_ATTRIBUTE));

    test("a document the host never told is the desktop, and a value that isn't true or false throws", () => {
        expect(paperMobile()).toBe(false);
        createRoot((dispose) => { expect(createPaperMobile()()).toBe(false); dispose(); });
        document.documentElement.setAttribute(MOBILE_ATTRIBUTE, "yes");
        expect(() => paperMobile()).toThrow(/"true" or "false"/);
    });

    test("the host's value is what is read, and the accessor follows it as it changes", async () => {
        setPaperMobile(true);
        expect(paperMobile()).toBe(true);
        await createRoot(async (dispose) => {
            const mobile = createPaperMobile();
            expect(mobile()).toBe(true);
            setPaperMobile(false);
            await Promise.resolve();
            expect(mobile()).toBe(false);
            dispose();
        });
    });
});
