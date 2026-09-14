import { describe, expect, test } from "bun:test";
import { isInstallableVanillaVersion } from "../src/lib/software";

// Mojang's manifest publishes no server jar for old_alpha/old_beta, nor for
// releases before 1.2.5. The picker must not offer what it cannot install.
describe("isInstallableVanillaVersion", () => {
    test("old alpha and beta have no server jar", () => {
        expect(isInstallableVanillaVersion("b1.7.3", "old_beta")).toBe(false);
        expect(isInstallableVanillaVersion("a1.2.6", "old_alpha")).toBe(false);
        expect(isInstallableVanillaVersion("b1.7.3", "beta")).toBe(false);
    });

    test("releases before 1.2.5 have no server jar", () => {
        expect(isInstallableVanillaVersion("1.0", "release")).toBe(false);
        expect(isInstallableVanillaVersion("1.1", "release")).toBe(false);
    });

    test("1.2.5 and later releases install", () => {
        expect(isInstallableVanillaVersion("1.2.5", "release")).toBe(true);
        expect(isInstallableVanillaVersion("1.7.10", "release")).toBe(true);
        expect(isInstallableVanillaVersion("1.12.2", "release")).toBe(true);
        expect(isInstallableVanillaVersion("26.2", "release")).toBe(true);
    });

    test("snapshots install", () => {
        expect(isInstallableVanillaVersion("13w16a", "snapshot")).toBe(true);
        expect(isInstallableVanillaVersion("25w44a", "snapshot")).toBe(true);
    });
});
