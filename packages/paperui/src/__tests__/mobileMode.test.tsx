import { afterEach, describe, expect, test } from "vitest";
import { createRoot } from "solid-js";
import { MOBILE_ATTRIBUTE, createPaperMobile, paperMobile, setPaperMobile } from "../utils/mobileMode";

// Inventory: mobile mode is the host's fact; an unknown one is an error, never "desktop".
describe("mobile mode", () => {
    afterEach(() => document.documentElement.removeAttribute(MOBILE_ATTRIBUTE));

    test("a document the host never told throws instead of guessing", () => {
        expect(() => paperMobile()).toThrow(MOBILE_ATTRIBUTE);
        expect(() => createRoot(() => createPaperMobile())).toThrow(MOBILE_ATTRIBUTE);
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
