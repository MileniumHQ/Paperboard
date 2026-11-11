import { describe, expect, test } from "bun:test";
import { withAppSettingsDefaults } from "../../src/shared/appSettingsDefaults";

const DEFAULTS = { darkMode: "system", reducedMotion: false, disableBlur: false, runOnStartup: false };

describe("app settings over their defaults", () => {
    test("settings saved before blur was its own setting keep blur off when reduce motion was on", () => {
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: true })).toMatchObject({ reducedMotion: true, disableBlur: true });
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: false })).toMatchObject({ reducedMotion: false, disableBlur: false });
    });

    test("a saved blur setting is kept as it is, whatever motion says", () => {
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: true, disableBlur: false })).toMatchObject({ reducedMotion: true, disableBlur: false });
        expect(withAppSettingsDefaults(DEFAULTS, { reducedMotion: false, disableBlur: true })).toMatchObject({ reducedMotion: false, disableBlur: true });
    });

    test("nothing saved is the defaults", () => {
        expect(withAppSettingsDefaults(DEFAULTS, {})).toEqual(DEFAULTS);
    });
});
