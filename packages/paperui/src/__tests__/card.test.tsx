import { render } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { PaperCard } from "../components/PaperCard";

describe("PaperCard flex shrinking", () => {
    it("a growing card can still shrink so it never overflows its parent", () => {
        const { container } = render(() => <PaperCard grow minHeight={0} />);
        expect((container.firstElementChild as HTMLElement).style.flexShrink).toBe("1");
    });

    it("an explicit shrink wins over the grow default", () => {
        const { container } = render(() => <PaperCard grow shrink={false} />);
        expect((container.firstElementChild as HTMLElement).style.flexShrink).toBe("0");
    });

    it("a plain card sets no inline shrink (the stylesheet holds it at 0)", () => {
        const { container } = render(() => <PaperCard />);
        expect((container.firstElementChild as HTMLElement).style.flexShrink).toBe("");
    });
});

describe("PaperCard accent", () => {
    it("exposes the role variables for a tinted surface and border", () => {
        const { container } = render(() => <PaperCard accent="danger" />);
        const card = container.firstElementChild as HTMLElement;
        expect(card.style.getPropertyValue("--role-base")).toBe("var(--paper-danger)");
        expect(card.style.getPropertyValue("--role-deep")).toBe("var(--paper-danger-deep)");
    });

    it("sets no role variables without an accent", () => {
        const { container } = render(() => <PaperCard />);
        const card = container.firstElementChild as HTMLElement;
        expect(card.style.getPropertyValue("--role-base")).toBe("");
    });
});
