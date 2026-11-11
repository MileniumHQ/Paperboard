import { describe, expect, test } from "bun:test";
import { withAppSettingsDefaults } from "../../src/shared/appSettingsDefaults";

const DEFAULTS: { darkMode: string; runOnStartup: boolean; disableAnimations?: boolean; disableBlur?: boolean } = { darkMode: "system", runOnStartup: false };

describe("app settings over their defaults", () => {
    test("reduce motion turned on before the split keeps animations and blur off", () => {
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: true })).toEqual({ ...DEFAULTS, disableAnimations: true, disableBlur: true });
    });

    test("reduce motion left off before the split is no choice at all", () => {
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: false })).toEqual(DEFAULTS);
    });

    test("a saved choice is kept as it is, and the other one stays unchosen", () => {
        expect(withAppSettingsDefaults(DEFAULTS, { disableAnimations: true })).toEqual({ ...DEFAULTS, disableAnimations: true });
        expect(withAppSettingsDefaults(DEFAULTS, { disableBlur: false })).toEqual({ ...DEFAULTS, disableBlur: false });
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: true, disableBlur: false })).toEqual({ ...DEFAULTS, disableAnimations: true, disableBlur: false });
    });

    test("nothing saved is the defaults", () => {
        expect(withAppSettingsDefaults(DEFAULTS, {})).toEqual(DEFAULTS);
    });
});
