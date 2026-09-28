import { render, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import { PaperMediaCard } from "../components/PaperMediaCard";
import { PaperBadge } from "../components/PaperBadge";
import { PaperText } from "../components/PaperText";

describe("PaperMediaCard Component Tests", () => {
    it("renders basic title and description correctly", () => {
        const { getByText } = render(() => (
            <PaperMediaCard
                title="Test Board"
                description="A test description of a board."
            />
        ));

        expect(getByText("Test Board")).toBeTruthy();
        expect(getByText("A test description of a board.")).toBeTruthy();
    });

    it("renders descriptionExtra outside the clamped description text", () => {
        const { getByText, container } = render(() => (
            <PaperMediaCard
                title="Fit Card"
                description="A model description."
                descriptionExtra={<span>Runs on your GPU</span>}
            />
        ));

        expect(getByText("Runs on your GPU")).toBeTruthy();
        const description = getByText("A model description.");
        expect(description.className).toContain("description");
        expect(description.contains(getByText("Runs on your GPU"))).toBe(false);
        expect(container.textContent).toContain("Runs on your GPU");
    });

    it("renders banner image and icon badge when supplied", () => {
        const { container } = render(() => (
            <PaperMediaCard
                banner="https://example.com/banner.png"
                bannerAlt="Test Banner Alt"
                icon="rocket"
                title="Rocket App"
            />
        ));

        const img = container.querySelector("img");
        expect(img).toBeTruthy();
        expect(img?.getAttribute("src")).toBe("https://example.com/banner.png");
        expect(img?.getAttribute("alt")).toBe("Test Banner Alt");
    });

    it("triggers onClick callback and applies interactive role when clickable", () => {
        const handleClick = vi.fn();
        const { getByRole } = render(() => (
            <PaperMediaCard
                title="Clickable Card"
                onClick={handleClick}
                footerLeft={<PaperBadge>v1.0</PaperBadge>}
                footerRight={<PaperText>By Developer</PaperText>}
            />
        ));

        const card = getByRole("button");
        expect(card).toBeTruthy();

        fireEvent.click(card);
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("does not trigger onClick when disabled", () => {
        const handleClick = vi.fn();
        const { container } = render(() => (
            <PaperMediaCard
                title="Disabled Card"
                disabled
                onClick={handleClick}
            />
        ));

        const card = container.firstChild as HTMLElement;
        fireEvent.click(card);
        expect(handleClick).not.toHaveBeenCalled();
    });

    it("renders a plain icon image without frame chrome", () => {
        const { container } = render(() => (
            <PaperMediaCard
                icon="/section.png"
                title="Plain Icon Card"
                plainIcon
            />
        ));

        const card = container.firstChild as HTMLElement;
        expect(card.className).toContain("iconPlain");

        const img = container.querySelector("img");
        expect(img?.getAttribute("src")).toBe("/section.png");
        expect(img?.className).toContain("iconStandalone");
        expect(img?.getAttribute("style")).toBeNull();
    });

    it("frames standalone icon images by default", () => {
        const { container } = render(() => (
            <PaperMediaCard icon="/section.png" title="Framed Icon Card" />
        ));

        const card = container.firstChild as HTMLElement;
        expect(card.className).not.toContain("iconPlain");
    });

    it("renders a link (not a button) when href is set", () => {
        const { container } = render(() => (
            <PaperMediaCard href="/paperui" title="PaperUI" />
        ));

        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/paperui");
        expect(container.querySelector('[role="button"]')).toBeNull();
    });

    it("keeps button semantics for onClick-only cards", () => {
        const { container } = render(() => (
            <PaperMediaCard
                title="Selectable"
                onClick={() => void 0}
            />
        ));

        expect(container.querySelector("a")).toBeNull();
        expect(container.querySelector('[role="button"]')).not.toBeNull();
    });
});
