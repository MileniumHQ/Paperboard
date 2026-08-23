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
});
