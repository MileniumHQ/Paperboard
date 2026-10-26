import { test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";
test("fixed pages reserve system insets once, with safe header controls and modals", async () => {
    const chrome = findChrome();
    expect(chrome, "Chrome is required for this layout regression").toBeTruthy();
    const result = await runFixture(chrome!, "src/__tests__/fixtures/safeAreaFixture.html");
    expect(result.error).toBe("");
    expect(result.checks).toEqual({ outerHeaderHeight: 114, nestedHeaderHeight: 54, controlsBelowStatusBar: true, modalInsideSafeArea: true });
}, 60000);
