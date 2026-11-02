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

describe("PaperMediaCard click area", () => {
    it("the footer row opens the card everywhere but on its controls", () => {
        const opened: string[] = [];
        const { getByText, getByRole } = render(() => (
            <PaperMediaCard
                title="Server"
                onClick={() => opened.push("card")}
                footerLeft={<span>12 players</span>}
                footerRight={
                    <div role="switch" aria-checked="false" tabIndex={0} onClick={() => opened.push("toggle")}>
                        <span>Enabled</span>
                    </div>
                }
            />
        ));
        fireEvent.click(getByText("12 players"));
        expect(opened).toEqual(["card"]);
        fireEvent.click(getByText("12 players").parentElement!.parentElement!);
        expect(opened).toEqual(["card", "card"]);
        // a click inside a control, even on its inner text, is the control's
        fireEvent.click(getByText("Enabled"));
        expect(opened).toEqual(["card", "card", "toggle"]);
        fireEvent.click(getByRole("switch"));
        expect(opened).toEqual(["card", "card", "toggle", "toggle"]);
    });

    it("a control in the card's content does its own thing too", () => {
        const opened: string[] = [];
        const { getByText } = render(() => (
            <PaperMediaCard title="Pack" onClick={() => opened.push("card")} description="A pack">
                <input aria-label="Name" />
                <button onClick={() => opened.push("remove")}>Remove</button>
            </PaperMediaCard>
        ));
        fireEvent.click(getByText("Remove"));
        fireEvent.click(document.querySelector("input")!);
        expect(opened).toEqual(["remove"]);
        fireEvent.click(getByText("A pack"));
        expect(opened).toEqual(["remove", "card"]);
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

describe("PaperMediaCard selection", () => {
    it("a chosen card is pressed for assistive technology and a card that only opens something is not", () => {
        const { getByRole } = render(() => (
            <>
                <PaperMediaCard title="Chosen" selected onClick={() => {}} />
                <PaperMediaCard title="Other" selected={false} onClick={() => {}} />
                <PaperMediaCard title="Opens" onClick={() => {}} />
            </>
        ));
        expect(getByRole("button", { name: "Chosen" }).getAttribute("aria-pressed")).toBe("true");
        expect(getByRole("button", { name: "Other" }).getAttribute("aria-pressed")).toBe("false");
        expect(getByRole("button", { name: "Opens" }).hasAttribute("aria-pressed")).toBe(false);
    });

    it("banner and poster pictures load as they scroll into view, so a grid of many cards doesn't fetch them all", () => {
        const { container } = render(() => <PaperMediaCard title="Map" banner="/banner.png" poster="/poster.png" />);
        for (const src of ["/banner.png", "/poster.png"]) expect(container.querySelector(`img[src="${src}"]`)!.getAttribute("loading")).toBe("lazy");
    });
});

describe("PaperMediaCard title", () => {
    it("breaks a title with no spaces, such as a map's file name, instead of letting it run out of the card", () => {
        const { getByText } = render(() => <PaperMediaCard title="arena_lumberyard_event" />);
        expect(getByText("arena_lumberyard_event").className).toContain("breakWord");
    });
});
