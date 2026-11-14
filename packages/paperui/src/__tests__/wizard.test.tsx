import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createEffect } from "solid-js";
import { PaperCheckbox, PaperInput, PaperToggle, PaperWizard, PaperWizardStep, useWizard } from "../index";

/** lets queued enters, exits and their microtask ends run */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const next = () => fireEvent.click(screen.getByRole("button", { name: /Next|Finish/ }));
const type = (label: string, value: string) => {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    input.value = value;
    fireEvent.input(input);
};

function Steps() {
    return (
        <>
            <PaperWizardStep index={0}>
                <PaperInput name="server" aria-label="Server name" />
                <PaperCheckbox name="whitelist" aria-label="Whitelist" />
                <PaperCheckbox name="pvp" aria-label="PvP" defaultChecked />
                <PaperToggle name="autostart" aria-label="Autostart" />
            </PaperWizardStep>
            <PaperWizardStep index={1}>
                <PaperInput name="motd" aria-label="Message of the day" />
            </PaperWizardStep>
        </>
    );
}

// Inventory: Menus and form controls — Wizard records the form truthfully.
describe("PaperWizard form record", () => {
    test("Finish records unchecked boxes as false and checked ones as true beside text fields", () => {
        const completed: Record<string, unknown>[] = [];
        render(() => (
            <PaperWizard onComplete={(data) => completed.push(data)}>
                <Steps />
            </PaperWizard>
        ));

        type("Server name", "Survival");
        next();
        type("Message of the day", "Welcome");
        next();

        expect(completed).toEqual([
            { server: "Survival", whitelist: false, pvp: true, autostart: false, motd: "Welcome" },
        ]);
    });

    test("Back reports the current step's typed values through onStepChange", () => {
        const steps: [number, Record<string, unknown>][] = [];
        render(() => (
            <PaperWizard onStepChange={(index, data) => steps.push([index, data])}>
                <Steps />
            </PaperWizard>
        ));

        type("Server name", "Creative");
        next();
        type("Message of the day", "Typed, not submitted");
        fireEvent.click(screen.getByRole("button", { name: /Back/ }));

        expect(steps.at(-1)).toEqual([
            0,
            { server: "Creative", whitelist: false, pvp: true, autostart: false, motd: "Typed, not submitted" },
        ]);
    });
});

// Inventory: Menus and form controls — A step skipped as it arrives leaves nothing behind.
describe("PaperWizard step skipped on arrival", () => {
    function Skipper() {
        const wizard = useWizard()!;
        // a shell's router: a step it has no use for is passed over either way
        let previous = 0;
        createEffect(() => {
            const step = wizard.currentStep();
            const from = previous;
            previous = step;
            if (from === 0 && step === 1) wizard.setCurrentStep(2);
            else if (from === 2 && step === 1) wizard.setCurrentStep(0);
        });
        return null;
    }

    const shownSteps = () => Array.from(document.querySelectorAll("[data-step]")).map((el) => el.getAttribute("data-step"));

    test("a step that becomes current and is left in the same update leaves the DOM, and Back lands on the step asked for", async () => {
        render(() => (
            <PaperWizard>
                <Skipper />
                <PaperWizardStep index={0} data-step="0">
                    first
                </PaperWizardStep>
                <PaperWizardStep index={1} data-step="1">
                    skipped
                </PaperWizardStep>
                <PaperWizardStep index={2} data-step="2">
                    last
                </PaperWizardStep>
            </PaperWizard>
        ));
        await settle();
        expect(shownSteps()).toEqual(["0"]);

        next();
        // passed over in the update that showed it: never painted, never fading
        expect(shownSteps()).not.toContain("1");
        await settle();
        expect(shownSteps()).toEqual(["2"]);

        fireEvent.click(screen.getByRole("button", { name: /Back/ }));
        expect(shownSteps()).not.toContain("1");
        await settle();
        expect(shownSteps()).toEqual(["0"]);
    });
});
