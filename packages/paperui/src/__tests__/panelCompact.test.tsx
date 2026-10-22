// A PaperPanel narrower than a phone: the menu fills the panel, and picking
// an entry slides its interface in as a page named after the entry, with a
// back button. A wide panel keeps menu and interface side by side.
import { describe, test, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperPanel, PAPER_PANEL_COMPACT_WIDTH } from "../templates/PaperPanel";
import { PaperMenu, PaperMenuItem } from "../components/PaperMenu";
import { PaperInterfaceGroup, PaperInterfaceItem } from "../templates/PaperInterfaceGroup";

let observerCb: ResizeObserverCallback | null = null;

class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
        observerCb = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {
        observerCb = null;
    }
}

function setWidth(px: number) {
    observerCb?.([{ contentRect: { width: px } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
}

beforeEach(() => {
    observerCb = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
});

function Panel() {
    const [tab, setTab] = createSignal("overview");
    return (
        <PaperPanel>
            <PaperMenu name="nav" value={tab()} onValueChange={(v) => setTab(String(v))}>
                <PaperMenuItem value="overview" icon="dashboard">Overview</PaperMenuItem>
                <PaperMenuItem value="players" icon="group">Players</PaperMenuItem>
            </PaperMenu>
            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="overview">Overview body</PaperInterfaceItem>
                <PaperInterfaceItem value="players">Players body</PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}

// the menu entry, not the page bar that repeats its name
const entry = (name: string) => screen.getAllByText(name).find((el) => el.closest("label"))!;
const page = () => screen.queryByRole("region") as HTMLElement | null;

describe("PaperPanel phone layout", () => {
    test("a wide panel has no page: menu and interface sit side by side", () => {
        render(() => <Panel />);
        setWidth(900);
        expect(page()).toBeNull();
        expect(screen.getByText("Overview body")).toBeDefined();
    });

    test("a narrow panel opens the tapped entry as a page and goes back", () => {
        render(() => <Panel />);
        setWidth(PAPER_PANEL_COMPACT_WIDTH - 118);

        // the menu is showing; the page waits off-screen, out of reach
        expect(page()?.inert).toBe(true);

        fireEvent.click(entry("Players"));
        expect(page()?.inert).toBe(false);
        expect(page()?.getAttribute("aria-label")).toBe("Players");
        expect(screen.getByText("Players body")).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        expect(page()?.inert).toBe(true);
    });

    test("tapping the entry already selected still opens its page", () => {
        render(() => <Panel />);
        setWidth(402);
        fireEvent.click(entry("Overview"));
        expect(page()?.inert).toBe(false);
        expect(page()?.getAttribute("aria-label")).toBe("Overview");
    });
});
