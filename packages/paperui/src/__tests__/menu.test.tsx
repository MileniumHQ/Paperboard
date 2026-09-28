import { describe, test, expect } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperMenu, PaperMenuSection, PaperMenuItem } from "../components/PaperMenu";
import { PaperSpacer } from "../components/PaperSpacer";

describe("PaperMenu & PaperMenuSection Tests", () => {
    test("renders PaperMenu with collapsible sections and toggles visibility on click", async () => {
        const [selected, setSelected] = createSignal("item1");

        render(() => (
            <PaperMenu name="test-menu" value={selected()} onValueChange={(v) => setSelected(String(v))}>
                <PaperMenuSection title="Section 1" defaultOpen={true}>
                    <PaperMenuItem value="item1">Item 1</PaperMenuItem>
                    <PaperMenuItem value="item2">Item 2</PaperMenuItem>
                </PaperMenuSection>
                <PaperSpacer />
                <PaperMenuSection title="Section 2" defaultOpen={false}>
                    <PaperMenuItem value="item3">Item 3</PaperMenuItem>
                </PaperMenuSection>
            </PaperMenu>
        ));

        expect(screen.getByText("Item 1")).toBeDefined();
        expect(screen.queryByText("Item 3")).toBeNull();

        await fireEvent.click(screen.getByText("Section 2"));
        expect(screen.getByText("Item 3")).toBeDefined();

        await fireEvent.click(screen.getByText("Section 1"));
        expect(screen.queryByText("Item 1")).toBeNull();
    });

    test("renders PaperSpacer without throwing error", () => {
        const { container } = render(() => <PaperSpacer size={20} direction="vertical" />);
        expect(container.firstChild).toBeDefined();
    });

    test("renders PaperMenu with spacing class when spacing prop is true", () => {
        const { container } = render(() => (
            <PaperMenu name="spacing-menu" spacing>
                <PaperMenuItem value="item1">Item 1</PaperMenuItem>
            </PaperMenu>
        ));
        expect(container.querySelector(".spacing") || container.firstChild).toBeDefined();
        const menuEl = container.firstElementChild as HTMLElement;
        expect(menuEl.className).toContain("spacing");
        expect(menuEl.style.getPropertyValue("--menu-spacing")).toBe("var(--paper-uigap-onefourth)");
    });

    test("renders PaperMenu with custom token spacing", () => {
        const { container } = render(() => (
            <PaperMenu name="spacing-half-menu" spacing="half">
                <PaperMenuItem value="item1">Item 1</PaperMenuItem>
            </PaperMenu>
        ));
        const menuEl = container.firstElementChild as HTMLElement;
        expect(menuEl.style.getPropertyValue("--menu-spacing")).toBe("var(--paper-uigap-half)");
    });
});

describe("PaperMenu embedded", () => {
    test("defaults to carrying its own sidebar frame", () => {
        const { container } = render(() => (
            <PaperMenu name="nav">
                <PaperMenuItem value="one">One</PaperMenuItem>
            </PaperMenu>
        ));
        const menu = container.querySelector("[class*='PaperMenu']");
        expect(menu?.className.includes("embedded")).toBe(false);
    });

    test("embedded drops the frame so a host sidebar can supply it", () => {
        const { container } = render(() => (
            <PaperMenu name="nav" embedded>
                <PaperMenuItem value="one">One</PaperMenuItem>
            </PaperMenu>
        ));
        const menu = container.querySelector("[class*='PaperMenu']");
        expect(menu?.className.includes("embedded")).toBe(true);
    });
});
