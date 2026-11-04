import { describe, test, expect, vi } from "vitest";
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

describe("PaperWizardStep hideBack", () => {
    test("a step can hide Back while the next step shows it again", async () => {
        render(() => (
            <PaperWizard>
                <PaperWizardStep index={0}>One</PaperWizardStep>
                <PaperWizardStep index={1} hideBack>Two</PaperWizardStep>
                <PaperWizardStep index={2}>Three</PaperWizardStep>
            </PaperWizard>
        ));
        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(await screen.findByText("Two")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(await screen.findByText("Three")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Back/ }));
        expect(await screen.findByText("Two")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    });
});

describe("PaperWizard collected data", () => {
    test("an unchecked checkbox records false, a checked one true", () => {
        const onComplete = vi.fn();
        render(() => (
            <PaperWizard onComplete={onComplete}>
                <PaperWizardStep index={0}>
                    <input type="checkbox" name="agree" />
                    <input type="checkbox" name="subscribe" checked />
                    <input name="host" value="localhost" />
                </PaperWizardStep>
            </PaperWizard>
        ));
        fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
        expect(onComplete).toHaveBeenCalledWith({ agree: false, subscribe: true, host: "localhost" });
    });

    test("Back keeps what the step's fields hold", async () => {
        const onStepChange = vi.fn();
        render(() => (
            <PaperWizard onStepChange={onStepChange}>
                <PaperWizardStep index={0}>One</PaperWizardStep>
                <PaperWizardStep index={1}>
                    <input name="host" value="localhost" />
                </PaperWizardStep>
            </PaperWizard>
        ));
        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        const field = (await screen.findByRole("textbox")) as HTMLInputElement;
        field.value = "example.com";
        fireEvent.click(screen.getByRole("button", { name: /Back/ }));
        expect(onStepChange).toHaveBeenLastCalledWith(0, { host: "example.com" });
    });
});
