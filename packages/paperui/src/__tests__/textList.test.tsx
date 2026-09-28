import { describe, test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperTextList } from "../components/PaperTextList";

describe("PaperTextList", () => {
    test("renders a ul by default and ol when ordered", () => {
        const { container: unordered } = render(() => (
            <PaperTextList>
                <PaperTextList.Item>Item 1</PaperTextList.Item>
            </PaperTextList>
        ));
        expect(unordered.querySelector("ul")).not.toBeNull();
        expect(unordered.querySelector("ol")).toBeNull();

        const { container: ordered } = render(() => (
            <PaperTextList ordered>
                <PaperTextList.Item>Item 1</PaperTextList.Item>
            </PaperTextList>
        ));
        expect(ordered.querySelector("ol")).not.toBeNull();
        expect(ordered.querySelector("ul")).toBeNull();
    });

    test("applies spacing variant classes", () => {
        const { container } = render(() => (
            <PaperTextList spacing="compact">
                <PaperTextList.Item>Item</PaperTextList.Item>
            </PaperTextList>
        ));
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toContain("compact");
    });

    test("applies text preset to the list and sets data-preset", () => {
        const { container } = render(() => (
            <PaperTextList preset="body">
                <PaperTextList.Item>Body item</PaperTextList.Item>
            </PaperTextList>
        ));
        const el = container.firstElementChild as HTMLElement;
        expect(el.getAttribute("data-preset")).toBe("body");
        expect(el.className).toContain("body");
    });

    test("child PaperTextList.Item inherits preset from PaperTextList", () => {
        const { container } = render(() => (
            <PaperTextList preset="caption">
                <PaperTextList.Item>Caption item</PaperTextList.Item>
            </PaperTextList>
        ));
        const li = container.querySelector("li")!;
        expect(li.getAttribute("data-preset")).toBe("caption");
        expect(li.style.fontWeight).toBe("500");
    });

    test("item can override the inherited list preset", () => {
        const { container } = render(() => (
            <PaperTextList preset="body">
                <PaperTextList.Item>Inherited item</PaperTextList.Item>
                <PaperTextList.Item preset="title">
                    Overridden item
                </PaperTextList.Item>
            </PaperTextList>
        ));
        const items = container.querySelectorAll("li");
        expect(items[0].getAttribute("data-preset")).toBe("body");
        expect(items[1].getAttribute("data-preset")).toBe("title");
    });

    test("child items inherit font-family and rounded options", () => {
        const { container } = render(() => (
            <PaperTextList family="code" rounded>
                <PaperTextList.Item>Code item</PaperTextList.Item>
            </PaperTextList>
        ));
        const list = container.firstElementChild as HTMLElement;
        expect(list.className).toContain("code");
        expect(list.className).toContain("rounded");

        const li = container.querySelector("li")!;
        expect(li.className).toContain("code");
        expect(li.className).toContain("rounded");
    });

    test("child items inherit color from the list", () => {
        const { container } = render(() => (
            <PaperTextList color="primary">
                <PaperTextList.Item>Colored item</PaperTextList.Item>
            </PaperTextList>
        ));
        const li = container.querySelector("li")!;
        expect(li.style.color).toContain("paper-primary");
    });
});
