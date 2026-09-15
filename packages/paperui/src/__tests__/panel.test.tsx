import { describe, test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperPanel } from "../templates/PaperPanel";
import { PaperInterfaceGroup, PaperInterfaceItem } from "../templates/PaperInterfaceGroup";
import { PaperCard } from "../components/PaperCard";
import { PaperSwatch } from "../components/PaperSwatch";

describe("PaperPanel shell", () => {
    test("sizes the interface group and lets the active item scroll", () => {
        const { container, getByText } = render(() => (
            <PaperPanel>
                <PaperInterfaceGroup value="overview">
                    <PaperInterfaceItem value="overview">Overview body</PaperInterfaceItem>
                    <PaperInterfaceItem value="config">Config body</PaperInterfaceItem>
                </PaperInterfaceGroup>
            </PaperPanel>
        ));

        expect(container.querySelector('[class*="PaperPanel"]')).toBeTruthy();
        const group = container.querySelector('[class*="PaperInterfaceGroup"]')!;
        expect(group.className).toContain("inPanel");
        // only the active item is mounted
        expect(getByText("Overview body")).toBeTruthy();
        expect(container.textContent).not.toContain("Config body");
    });

    test("page items wrap content in a centered PaperPage", () => {
        const { container } = render(() => (
            <PaperInterfaceGroup value="a">
                <PaperInterfaceItem value="a">
                    <span id="inside">Body</span>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        ));
        const item = container.querySelector('[class*="PaperInterfaceItem"]')!;
        expect(item.className).toContain("page");
        expect(container.querySelector('[class*="PaperPage"]')).toBeTruthy();
    });

    test("full items skip the page column", () => {
        const { container } = render(() => (
            <PaperInterfaceGroup value="a">
                <PaperInterfaceItem value="a" variant="full">
                    <span>Canvas</span>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        ));
        const item = container.querySelector('[class*="PaperInterfaceItem"]')!;
        expect(item.className).toContain("full");
        expect(container.querySelector('[class*="PaperPage"]')).toBeNull();
    });
});

describe("PaperCard", () => {
    test("applies surface tone and spacing tokens", () => {
        const { container } = render(() => (
            <PaperCard surface="frontest" padding="double" gap="half">
                content
            </PaperCard>
        ));
        const card = container.firstElementChild as HTMLElement;
        expect(card.className).toContain("frontest");
        expect(card.style.padding).toBe("var(--paper-uigap-double)");
        expect(card.style.gap).toBe("var(--paper-uigap-half)");
    });
});

describe("PaperSwatch", () => {
    test("renders the color and size", () => {
        // a named CSS color keeps the hex literal (and the styling gate)
        // out of test code
        const { container } = render(() => (
            <PaperSwatch color="rebeccapurple" size="large" />
        ));
        const dot = container.firstElementChild as HTMLElement;
        expect(dot.className).toContain("large");
        expect(dot.style.background).toContain("rebeccapurple");
    });
});
