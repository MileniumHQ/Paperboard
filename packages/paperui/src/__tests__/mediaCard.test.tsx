import { fireEvent, render } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { PaperMediaCard } from "../components/PaperMediaCard";

describe("PaperMediaCard footer controls", () => {
    it("a footer button does its own thing without also opening the card", () => {
        const opened: string[] = [];
        const { getByText, getByRole } = render(() => (
            <PaperMediaCard
                title="Project"
                onClick={() => opened.push("card")}
                footerRight={<button onClick={() => opened.push("button")}>Rename</button>}
            />
        ));
        fireEvent.click(getByText("Rename"));
        expect(opened).toEqual(["button"]);
        fireEvent.click(getByText("Project"));
        expect(opened).toEqual(["button", "card"]);
        // Enter on the card itself opens it; Enter on the footer button doesn't
        fireEvent.keyDown(getByText("Rename"), { key: "Enter" });
        expect(opened).toEqual(["button", "card"]);
        fireEvent.keyDown(getByRole("button", { name: /Project/ }), { key: "Enter" });
        expect(opened).toEqual(["button", "card", "card"]);
    });
});

describe("PaperMediaCard poster", () => {
    it("portrait art takes the icon's place, beside the title under a banner", () => {
        const { container, getByText } = render(() => (
            <PaperMediaCard
                banner="/banner.webp"
                poster="/poster.webp"
                posterAlt="Terraria cover"
                icon="/icon.png"
                title="Terraria"
            />
        ));
        const poster = container.querySelector<HTMLImageElement>('img[src="/poster.webp"]')!;
        expect(poster.alt).toBe("Terraria cover");
        expect(poster.parentElement!.className).toContain("posterWrapper");
        // the poster's frame is part of the banner, so it overlaps the banner's edge
        expect(poster.parentElement!.parentElement).toBe(container.querySelector('img[src="/banner.webp"]')!.parentElement);
        // it replaces the icon instead of stacking with it
        expect(container.querySelector('img[src="/icon.png"]')).toBeNull();
        expect(getByText("Terraria").closest("[class*=body]")!.className).toContain("bodyBesidePoster");
        // sized by tokens: no inline style anywhere on the poster
        expect(poster.hasAttribute("style")).toBe(false);
        expect(poster.parentElement!.hasAttribute("style")).toBe(false);
    });

    it("without a banner the poster stands above the title and the text stays full width", () => {
        const { container, getByText } = render(() => <PaperMediaCard poster="/poster.webp" title="Palworld" />);
        const poster = container.querySelector<HTMLImageElement>('img[src="/poster.webp"]')!;
        expect(poster.className).toContain("posterStandalone");
        expect(poster.compareDocumentPosition(getByText("Palworld")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(getByText("Palworld").closest("[class*=body]")!.className).not.toContain("bodyBesidePoster");
    });

    it("cards without a poster are unchanged", () => {
        const { container } = render(() => <PaperMediaCard banner="/banner.webp" icon="/icon.png" title="Plain" />);
        expect(container.querySelector('[class*="posterWrapper"]')).toBeNull();
        expect(container.querySelector('img[src="/icon.png"]')).not.toBeNull();
        expect(container.querySelector('[class*="bodyBesidePoster"]')).toBeNull();
    });
});
