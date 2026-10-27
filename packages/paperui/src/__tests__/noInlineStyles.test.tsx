// The props that let a panel lay out and tint its UI without a style tag.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@solidjs/testing-library";
import { PaperFlex } from "../templates/PaperFlex";
import { PaperCard } from "../components/PaperCard";
import { PaperList, PaperListItem, PaperListLabel } from "../components/PaperList";
import { PaperMenu, PaperMenuItem, PaperMenuLabel } from "../components/PaperMenu";
import { PaperAvatar } from "../components/PaperAvatar";
import { PaperIcon } from "../components/PaperIcon";
import { PaperInterfaceGroup, PaperInterfaceItem } from "../templates/PaperInterfaceGroup";
import { PaperGrid } from "../components/PaperGrid";
import { PaperMediaCardGroup } from "../components/PaperMediaCard";
import { PaperSwatch } from "../components/PaperSwatch";
import { paperSizes } from "../types";

describe("size tokens", () => {
    test("every size name is a token the stylesheet defines", () => {
        const css = readFileSync(resolve(__dirname, "../styles/styles.css"), "utf8");
        for (const size of paperSizes) {
            expect(css).toContain(`--paper-size-${size}:`);
        }
    });

    test("height and min sizes resolve token names to their variables", () => {
        const { getByTestId } = render(() => (
            <PaperFlex data-testid="box" height="panel-height-small" minWidth="field" minHeight={0}>
                body
            </PaperFlex>
        ));
        const el = getByTestId("box");
        expect(el.style.height).toBe("var(--paper-size-panel-height-small)");
        expect(el.style.minWidth).toBe("var(--paper-size-field)");
        expect(el.style.minHeight).toBe("0px");
    });

    test("grids take a size token for their column width", () => {
        const { getByTestId } = render(() => (
            <>
                <PaperGrid data-testid="grid" min="field">a</PaperGrid>
                <PaperMediaCardGroup data-testid="cards" minCardWidth="card-min">b</PaperMediaCardGroup>
            </>
        ));
        expect(getByTestId("grid").style.gridTemplateColumns).toContain("var(--paper-size-field)");
        expect(getByTestId("cards").style.gridTemplateColumns).toContain("var(--paper-size-card-min)");
    });

    test("fullWidth={false} sizes a card to its content", () => {
        const { getByTestId } = render(() => (
            <PaperCard data-testid="card" fullWidth={false}>body</PaperCard>
        ));
        expect(getByTestId("card").style.width).toBe("auto");
    });
});

describe("PaperList", () => {
    test("takes a surface and group labels", () => {
        const { getByTestId, getByText } = render(() => (
            <PaperList name="people" data-testid="list" background="transparent">
                <PaperListLabel as="h3">Online (1)</PaperListLabel>
                <PaperListItem value="a">A</PaperListItem>
            </PaperList>
        ));
        expect(getByTestId("list").style.background).toBe("transparent");
        const label = getByText("Online (1)");
        expect(label.tagName).toBe("H3");
        expect(label.className).toContain("PaperListLabel");
        expect(label.dataset.preset).toBe("section");
    });
});

describe("PaperMenuLabel", () => {
    test("labels a group of entries without becoming one", () => {
        const { getByText, container } = render(() => (
            <PaperMenu name="nav" value="a">
                <PaperMenuLabel>Play</PaperMenuLabel>
                <PaperMenuItem value="a">Chat</PaperMenuItem>
            </PaperMenu>
        ));
        const label = getByText("Play");
        expect(label.className).toContain("menuLabel");
        expect(label.dataset.preset).toBe("section");
        expect(container.querySelectorAll("input[type=radio]").length).toBe(1);
    });
});

describe("PaperAvatar accent", () => {
    test("tints the fallback chip with the role", () => {
        const { container } = render(() => <PaperAvatar fallbackIcon="public" accent="success" />);
        const avatar = container.firstElementChild as HTMLElement;
        expect(avatar.className).toContain("accent");
        expect(avatar.style.getPropertyValue("--role-base")).toBe("var(--paper-success)");
    });
});

describe("PaperSwatch", () => {
    test("takes a color token name", () => {
        const { container } = render(() => <PaperSwatch color="success" />);
        expect((container.firstElementChild as HTMLElement).style.background).toBe("var(--paper-success)");
    });
});

describe("PaperIcon images", () => {
    test("tint draws the image as a stencil in the text color", () => {
        const { container } = render(() => <PaperIcon src="/logo.svg" tint />);
        expect(container.querySelector("img")).toBeNull();
        const stencil = container.querySelector('[class*="tint"]') as HTMLElement;
        expect(stencil.style.getPropertyValue("--paper-icon-mask")).toBe('url("/logo.svg")');
    });

    test("pixelated keeps pixel art crisp", () => {
        const { container } = render(() => <PaperIcon src="/head.png" pixelated />);
        expect(container.querySelector("img")!.className).toContain("pixelated");
    });
});

describe("PaperInterfaceItem fill", () => {
    test("hosts a full-height page column at the requested width", () => {
        const { container } = render(() => (
            <PaperInterfaceGroup value="a">
                <PaperInterfaceItem value="a" variant="fill" width="full">
                    <span>Console</span>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        ));
        const item = container.querySelector('[class*="PaperInterfaceItem"]')!;
        expect(item.className).toContain("fill");
        const page = container.querySelector('[class*="PaperPage"]') as HTMLElement;
        expect(page.className).toContain("full");
        expect(page.style.height).toBe("100%");
    });
});
