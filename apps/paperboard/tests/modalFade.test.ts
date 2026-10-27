// A modal stays mounted and fades out when it closes; what it showed has to
// stay for that fade instead of vanishing from an emptying box, and a wizard
// in one starts over the next time it opens. Real components on real PaperUI
// in headless Chrome.
import { describe, expect, test } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
if (!chrome) console.warn("modalFade: skipped, no Chrome found (set PAPERBOARD_CHROME)");

describe.skipIf(!chrome)("stay-mounted modals", () => {
    test("keep their content through the fade and start over on reopen", async () => {
        const { checks, error } = await runBrowserFixture(chrome!, "tests/fixtures/modalFade/index.html");
        expect(error).toBe("");
        expect(checks).toEqual({
            tutorialOnSecondStep: true,
            tutorialFadesWithItsStep: true,
            tutorialKeepsItsName: true,
            tutorialStartsOver: true,
            setupFadesWithItsContent: true,
            setupMounts: 2,
            licenseFadesWithItsText: true,
            licenseKeepsItsTitle: "MIT license",
        });
    }, 90_000);
});
