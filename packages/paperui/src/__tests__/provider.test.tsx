import { describe, test, expect, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperProvider } from "../components/PaperProvider";

describe("PaperProvider - Dynamic System Theme Tests", () => {
    test("resolves theme attribute cleanly for explicit light/dark modes", () => {
        const { container } = render(() => (
            <PaperProvider theme="dark">
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.getAttribute("data-paperui-theme")).toBe("dark");
    });

    test("dynamically resolves system theme mode using matchMedia", () => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
            matches: query.includes("dark"),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        const { container } = render(() => (
            <PaperProvider theme="system">
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.getAttribute("data-paperui-theme")).toBe("dark");
    });

    test("applies scrollable class when scrollable prop is provided", () => {
        const { container } = render(() => (
            <PaperProvider theme="dark" fullScreen scrollable>
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.classList.contains("scrollable")).toBe(true);
        expect(root?.classList.contains("fullScreen")).toBe(true);
    });
});
