import { describe, test, expect, vi, afterEach } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperProvider } from "../components/PaperProvider";

function mockSystemDark(dark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: dark && query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

afterEach(() => {
    document.documentElement.removeAttribute("data-paperui-theme");
});

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

describe("PaperProvider - host-injected theme", () => {
    test("host <html> theme wins over the OS when no theme prop is given", () => {
        mockSystemDark(false);
        document.documentElement.setAttribute("data-paperui-theme", "dark");

        const { container } = render(() => (
            <PaperProvider>
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.getAttribute("data-paperui-theme")).toBe("dark");
    });

    test("an explicit theme prop still wins over the host", () => {
        mockSystemDark(true);
        document.documentElement.setAttribute("data-paperui-theme", "dark");

        const { container } = render(() => (
            <PaperProvider theme="light">
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.getAttribute("data-paperui-theme")).toBe("light");
    });

    test("falls back to the OS when neither host nor prop sets a theme", () => {
        mockSystemDark(true);

        const { container } = render(() => (
            <PaperProvider>
                <p>Content</p>
            </PaperProvider>
        ));

        const root = container.querySelector(".paperui-root");
        expect(root?.getAttribute("data-paperui-theme")).toBe("dark");
    });
});
