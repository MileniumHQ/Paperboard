import { describe, test, expect } from "vitest";
import {
    render,
    screen,
    fireEvent,
    within,
} from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperSelectMenu, PaperSelectMenuItem } from "../components/PaperSelectMenu";

// The trigger and the always-mounted option menu can share label text —
// scope queries to the trigger button or the listbox to disambiguate.
function getTrigger() {
    return screen.getByRole("button");
}

function getListbox() {
    return screen.getByRole("listbox", { hidden: false });
}

describe("PaperSelectMenu", () => {
    test("shows the selected option label on the trigger", () => {
        render(() => (
            <PaperSelectMenu name="theme" value="dark">
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="light">Light</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        expect(within(getTrigger()).getByText("Dark")).toBeDefined();
    });

    test("mirrors the selected option's icon on the trigger", () => {
        render(() => (
            <PaperSelectMenu name="model" value="a">
                <PaperSelectMenuItem value="a" icon="rocket">Alpha</PaperSelectMenuItem>
                <PaperSelectMenuItem value="b" icon="public">Beta</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        const trigger = getTrigger();
        expect(within(trigger).getByText("rocket")).toBeDefined();
        expect(within(trigger).getByText("Alpha")).toBeDefined();
    });

    test("shows placeholder when nothing is selected", () => {
        render(() => (
            <PaperSelectMenu name="theme" placeholder="Pick one">
                <PaperSelectMenuItem value="a">Alpha</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        expect(screen.getByText("Pick one")).toBeDefined();
        expect(within(getTrigger()).queryByText("Alpha")).toBeNull();
    });

    test("selecting an option notifies onValueChange and updates the trigger", async () => {
        let received: string | undefined;
        render(() => (
            <PaperSelectMenu
                name="theme"
                defaultValue="system"
                onValueChange={(v) => (received = String(v))}
            >
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(getTrigger());
        fireEvent.click(within(getListbox()).getByText("Dark"));

        expect(received).toBe("dark");
        await Promise.resolve();
        expect(within(getTrigger()).getByText("Dark")).toBeDefined();
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

        fireEvent.click(getTrigger());
        fireEvent.click(within(getListbox()).getByText("Dark"));

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
        fireEvent.keyDown(wrapper, { key: "Enter" });
        fireEvent.keyDown(wrapper, { key: "ArrowDown" });
        fireEvent.keyDown(wrapper, { key: "Enter" });

        expect(received).toBe("dark");
    });

    test("keyboard: ArrowDown opens and highlights the current value first", async () => {
        let received: string | undefined;
        const { container } = render(() => (
            <PaperSelectMenu
                name="theme"
                value="light"
                onValueChange={(v) => (received = String(v))}
            >
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="light">Light</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        const wrapper = container.firstElementChild as HTMLElement;
        fireEvent.keyDown(wrapper, { key: "ArrowDown" });
        fireEvent.keyDown(wrapper, { key: "ArrowDown" });
        fireEvent.keyDown(wrapper, { key: "Enter" });

        expect(received).toBe("dark");
    });

    test("keyboard: Escape closes without committing a change", () => {
        let changed = false;
        const { container } = render(() => (
            <PaperSelectMenu name="theme" value="system" onValueChange={() => (changed = true)}>
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        const wrapper = container.firstElementChild as HTMLElement;
        fireEvent.keyDown(wrapper, { key: "ArrowDown" });
        expect(getTrigger().getAttribute("aria-expanded")).toBe("true");

        fireEvent.keyDown(wrapper, { key: "Escape" });
        expect(getTrigger().getAttribute("aria-expanded")).toBe("false");
        expect(changed).toBe(false);
    });

    test("clicking outside closes the popup", () => {
        render(() => (
            <>
                <div data-testid="outside" />
                <PaperSelectMenu name="theme" value="system">
                    <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                </PaperSelectMenu>
            </>
        ));

        fireEvent.click(getTrigger());
        expect(getTrigger().getAttribute("aria-expanded")).toBe("true");

        fireEvent.pointerDown(screen.getByTestId("outside"));
        expect(getTrigger().getAttribute("aria-expanded")).toBe("false");
    });

    test("disabled select ignores clicks and stays closed", () => {
        let changed = false;
        render(() => (
            <PaperSelectMenu
                name="theme"
                value="system"
                disabled
                onValueChange={() => (changed = true)}
            >
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        expect(getTrigger().hasAttribute("disabled")).toBe(true);

        fireEvent.click(getTrigger());
        expect(getTrigger().getAttribute("aria-expanded")).toBe("false");

        fireEvent.click(
            within(screen.getByRole("listbox", { hidden: true })).getByText("Dark"),
        );
        expect(changed).toBe(false);
    });

    test("a wide menu near the right edge keeps its right edge on the trigger", async () => {
        const rect = (left: number, top: number, width: number, height: number) =>
            ({
                left,
                top,
                width,
                height,
                right: left + width,
                bottom: top + height,
                x: left,
                y: top,
                toJSON: () => ({}),
            }) as DOMRect;

        render(() => (
            <PaperSelectMenu name="personality" value="standard">
                <PaperSelectMenuItem value="standard" description="Friendly and clear.">
                    Standard
                </PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        const trigger = getTrigger();
        trigger.getBoundingClientRect = () => rect(700, 100, 200, 30);
        const menu = screen.getByRole("listbox", { hidden: true });
        // wider than the space to the right of the trigger's left edge
        menu.getBoundingClientRect = () => rect(0, 0, 400, 200);

        fireEvent.click(trigger);
        await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
        );

        // jsdom's viewport is 1024 wide: 700 + 400 overflows, so the menu
        // grows leftward with its right edge (900) on the trigger's
        expect(menu.style.left).toBe("500px");
    });

    test("renders option descriptions in the shared menu item", () => {
        render(() => (
            <PaperSelectMenu name="personality" value="standard">
                <PaperSelectMenuItem
                    value="standard"
                    description="Friendly and clear. The default."
                >
                    Standard
                </PaperSelectMenuItem>
                <PaperSelectMenuItem
                    value="quirky"
                    description="Playful and opinionated, with puns."
                >
                    Quirky
                </PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(getTrigger());
        expect(
            within(getListbox()).getByText("Playful and opinionated, with puns."),
        ).toBeDefined();
    });

    test("the selected option is marked in the listbox", () => {
        render(() => (
            <PaperSelectMenu name="personality" value="quirky">
                <PaperSelectMenuItem value="standard">Standard</PaperSelectMenuItem>
                <PaperSelectMenuItem value="quirky">Quirky</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(getTrigger());
        const options = screen.getAllByRole("option");
        expect(options[0].getAttribute("aria-selected")).toBe("false");
        expect(options[1].getAttribute("aria-selected")).toBe("true");
    });

    test("controlled component does not change without external state update", () => {
        const [value, setValue] = createSignal("system");
        render(() => (
            <PaperSelectMenu name="theme" value={value()}>
                <PaperSelectMenuItem value="system">System</PaperSelectMenuItem>
                <PaperSelectMenuItem value="dark">Dark</PaperSelectMenuItem>
            </PaperSelectMenu>
        ));

        fireEvent.click(getTrigger());
        fireEvent.click(within(getListbox()).getByText("Dark"));

        // Trigger still shows "system" — controlled semantics preserved
        expect(within(getTrigger()).getByText("System")).toBeDefined();
        setValue("dark");
        expect(within(getTrigger()).getByText("Dark")).toBeDefined();
    });
});
