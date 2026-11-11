import { describe, expect, test } from "bun:test";
import { effectiveLook, graphicsFrom } from "../../src/shared/graphics";

describe("drawing without a GPU", () => {
    test("Chromium compositing on a GPU is a GPU; in software, it isn't", () => {
        expect(graphicsFrom("enabled")).toEqual({ gpu: true });
        expect(graphicsFrom("enabled_on")).toEqual({ gpu: true });
        for (const status of ["disabled_software", "unavailable_software", "disabled_off", "unavailable_off"]) expect(graphicsFrom(status)).toEqual({ gpu: false });
    });

    test("with nothing chosen, animations and blur are off only without one", () => {
        expect(effectiveLook({}, { gpu: false })).toEqual({ disableAnimations: true, disableBlur: true });
        expect(effectiveLook({}, { gpu: true })).toEqual({ disableAnimations: false, disableBlur: false });
    });

    test("a choice is what shows, with a GPU or without", () => {
        for (const gpu of [false, true]) {
            for (const disableAnimations of [false, true]) {
                for (const disableBlur of [false, true]) {
                    expect(effectiveLook({ disableAnimations, disableBlur }, { gpu })).toEqual({ disableAnimations, disableBlur });
                }
            }
        }
    });

    test("each is chosen on its own", () => {
        expect(effectiveLook({ disableBlur: false }, { gpu: false })).toEqual({ disableAnimations: true, disableBlur: false });
    });
});
