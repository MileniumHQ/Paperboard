import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperMenu, PaperMenuSection, PaperMenuItem } from "../components/PaperMenu";
import { PaperSpacer } from "../components/PaperSpacer";
import { PaperRail, PaperRailItem } from "../components/PaperRail";

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

    test("spacing={false} packs the items with no gap; the default is left to the stylesheet's quarter gap", () => {
        const { container } = render(() => (
            <>
                <PaperMenu name="tight-menu" spacing={false}>
                    <PaperMenuItem value="a">A</PaperMenuItem>
                </PaperMenu>
                <PaperMenu name="default-menu">
                    <PaperMenuItem value="a">A</PaperMenuItem>
                </PaperMenu>
            </>
        ));
        const [tight, plain] = [...container.children] as HTMLElement[];
        expect(tight!.style.getPropertyValue("--menu-spacing")).toBe("0px");
        expect(plain!.style.getPropertyValue("--menu-spacing")).toBe("");
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
    test("an entry with href is a link, and the menu value marks the current page", () => {
        const { container } = render(() => (
            <PaperMenu name="links" value="b">
                <PaperMenuItem value="a" href="/a/">A</PaperMenuItem>
                <PaperMenuItem value="b" href="/b/">B</PaperMenuItem>
            </PaperMenu>
        ));
        const links = container.querySelectorAll("a");
        expect(links.length).toBe(2);
        expect(links[0].getAttribute("href")).toBe("/a/");
        expect(links[0].getAttribute("aria-current")).toBeNull();
        expect(links[1].getAttribute("aria-current")).toBe("page");
        expect(container.querySelector("input[type=radio]")).toBeNull();
    });
});

describe("PaperMenu link entries", () => {
    test("arrow keys move through link entries as well as choices", () => {
        const { getByText } = render(() => (
            <PaperMenu name="mixed" value="a">
                <PaperMenuItem value="a">A</PaperMenuItem>
                <PaperMenuItem value="b" href="/b/">B</PaperMenuItem>
                <PaperMenuItem value="c" href="/c/" disabled>C</PaperMenuItem>
                <PaperMenuItem value="d">D</PaperMenuItem>
            </PaperMenu>
        ));
        const first = getByText("A").closest("label")!;
        first.focus();
        fireEvent.keyDown(first, { key: "ArrowDown" });
        expect(document.activeElement).toBe(getByText("B").closest("a"));
        // a disabled link is skipped, like a disabled choice
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
        expect(document.activeElement).toBe(getByText("D").closest("label"));
    });

    test("a link entry passes its other props to the link", () => {
        const onClick = vi.fn((e: MouseEvent) => e.preventDefault());
        const { getByText } = render(() => (
            <PaperMenu name="links" value="a">
                <PaperMenuItem value="a" href="/a/" id="entry-a" data-entry="a" onClick={onClick}>
                    A
                </PaperMenuItem>
            </PaperMenu>
        ));
        const link = getByText("A").closest("a")!;
        expect(link.id).toBe("entry-a");
        expect(link.getAttribute("data-entry")).toBe("a");
        link.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe("single-choice containers", () => {
    test("PaperMenu and PaperRail do not take the multiple-choice props", () => {
        // these props would land on the div as attributes: the types refuse them
        // @ts-expect-error PaperMenu chooses one entry
        const menu = () => <PaperMenu name="m" multiple values={["a"]} />;
        // @ts-expect-error PaperRail chooses one item
        const rail = () => <PaperRail name="r" multiple defaultValues={["a"]} />;
        expect(typeof menu).toBe("function");
        expect(typeof rail).toBe("function");
    });
});

describe("PaperRailItem naming", () => {
    test("a caller's aria-label and title win over the label", () => {
        const { getByRole } = render(() => (
            <PaperRail name="rail" value="a">
                <PaperRailItem value="a" icon="home" label="Home" aria-label="Go home" title="Home page" />
                <PaperRailItem value="b" icon="settings" label="Settings" />
            </PaperRail>
        ));
        const home = getByRole("radio", { name: "Go home" });
        expect(home.getAttribute("title")).toBe("Home page");
        const settings = getByRole("radio", { name: "Settings" });
        expect(settings.getAttribute("title")).toBe("Settings");
    });
});
