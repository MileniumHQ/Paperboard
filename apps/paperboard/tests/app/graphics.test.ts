import { describe, expect, test } from "bun:test";
import { effectiveLook, graphicsFrom } from "../../src/shared/graphics";

describe("drawing without a GPU", () => {
    test("Chromium compositing on a GPU is a GPU; in software, it isn't", () => {
        expect(graphicsFrom("enabled")).toEqual({ gpu: true });
        expect(graphicsFrom("enabled_on")).toEqual({ gpu: true });
        for (const status of ["disabled_software", "unavailable_software", "disabled_off", "unavailable_off"]) expect(graphicsFrom(status)).toEqual({ gpu: false });
    });

    test("without one, animations and blur are off whatever the settings say", () => {
        expect(effectiveLook({ reducedMotion: false, disableBlur: false }, { gpu: false })).toEqual({ reducedMotion: true, disableBlur: true });
    });

    test("with one, the settings are what shows", () => {
        for (const reducedMotion of [false, true]) {
            for (const disableBlur of [false, true]) {
                expect(effectiveLook({ reducedMotion, disableBlur }, { gpu: true })).toEqual({ reducedMotion, disableBlur });
            }
        }
    });
});
