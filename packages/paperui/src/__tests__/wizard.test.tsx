import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { PaperCheckbox, PaperInput, PaperToggle, PaperWizard, PaperWizardStep } from "../index";

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
