import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperSelectMenu, PaperSelectMenuItem } from "../components/PaperSelectMenu";

describe("PaperSelectMenu", () => {
    test("shows the selected option label on the trigger", () => {
        render(() => (
            <PaperSelectMenu name="theme" value="dark">
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="light">Light</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        expect(screen.getByText("Dark")).toBeDefined();
    });

    test("shows placeholder when nothing is selected", () => {
        render(() => (
            <PaperSelectMenu name="theme" placeholder="Pick one">
                <PaperSelectMenuItem value="a">Alpha</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        expect(screen.getByText("Pick one")).toBeDefined();
    });

    test("selecting an option notifies onValueChange and updates the trigger", async () => {
        let received: string | undefined;
        const { getByText } = render(() => (
            <PaperSelectMenu
                name="theme"
                value="system"
                onValueChange={(v) => (received = String(v))}
            >
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(screen.getByText("System")); // opens the popup
        fireEvent.click(getByText("Dark"));

        expect(received).toBe("dark");
        await Promise.resolve();
        expect(getByText("Dark")).toBeDefined();
    });

    test("dispatches bubbling change events from the named carrier input", () => {
        const events: string[] = [];
        render(() => (
            <div
                onChange={() => events.push("change")}
                onInput={() => events.push("input")}
            >
                <PaperSelectMenu name="theme" value="system">
                    <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                    <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
                </PaperSelectMenu>
            </div>
        ));

        fireEvent.click(screen.getByText("System"));
        fireEvent.click(screen.getByText("Dark"));

        expect(events).toContain("change");
        expect(events).toContain("input");
    });

    test("keyboard: Enter selects the highlighted option", async () => {
        let received: string | undefined;
        const { container } = render(() => (
            <PaperSelectMenu
                name="theme"
                value="system"
                onValueChange={(v) => (received = String(v))}
            >
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        const wrapper = container.firstElementChild as HTMLElement;
        fireEvent.keyDown(wrapper, { key: "Enter" }); // open
        fireEvent.keyDown(wrapper, { key: "ArrowDown" }); // highlight "dark"
        fireEvent.keyDown(wrapper, { key: "Enter" }); // commit

        expect(received).toBe("dark");
    });

    test("controlled component does not change without external state update", () => {
        const [value, setValue] = createSignal("system");
        render(() => (
            <PaperSelectMenu name="theme" value={value()}>
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(screen.getByText("System"));
        fireEvent.click(screen.getByText("Dark"));

        // Trigger still shows "system" — controlled semantics preserved
        expect(screen.getByText("System")).toBeDefined();
        setValue("dark");
        expect(screen.getByText("Dark")).toBeDefined();
    });
});
