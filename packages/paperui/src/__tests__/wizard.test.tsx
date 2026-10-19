import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { PaperWizard, PaperWizardStep } from "../templates/PaperWizard";

describe("PaperWizard progress dots", () => {
    test("shows one dot per step and moves the current step on Next", async () => {
        render(() => (
            <PaperWizard>
                <PaperWizardStep index={0}>One</PaperWizardStep>
                <PaperWizardStep index={1}>Two</PaperWizardStep>
                <PaperWizardStep index={2}>Three</PaperWizardStep>
            </PaperWizard>
        ));
        const progress = screen.getByRole("progressbar");
        expect(progress.children.length).toBe(3);
        expect(progress.getAttribute("aria-valuetext")).toBe("Step 1 of 3");

        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(await screen.findByText("Two")).toBeTruthy();
        expect(progress.getAttribute("aria-valuenow")).toBe("2");
        expect(progress.getAttribute("aria-valuetext")).toBe("Step 2 of 3");
    });
});
