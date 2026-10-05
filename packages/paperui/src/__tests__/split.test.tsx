import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperSplit } from "../templates/PaperSplit";

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
    observerCb?.(
        [{ contentRect: { width: px } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
    );
}

beforeEach(() => {
    observerCb = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        MockResizeObserver;
});

describe("PaperSplit", () => {
    test("lays side and detail side by side when there is room", () => {
        render(() => (
            <PaperSplit side={<div>roster</div>} detailTitle="Detail">
                <div>inspector</div>
            </PaperSplit>
        ));
        setWidth(900);
        expect(screen.getByText("roster")).toBeDefined();
        expect(screen.getByText("inspector")).toBeDefined();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("collapses to the side pane only when the detail is inactive", () => {
        render(() => (
            <PaperSplit side={<div>roster</div>} detailActive={false}>
                <div>inspector</div>
            </PaperSplit>
        ));
        setWidth(400);
        expect(screen.getByText("roster")).toBeDefined();
        expect(screen.queryByText("inspector")).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("presents the detail in a modal when collapsed and active, and closes it", async () => {
        const [active, setActive] = createSignal(true);
        const onClose = vi.fn(() => setActive(false));
        render(() => (
            <PaperSplit
                side={<div>roster</div>}
                detailActive={active()}
                onDetailClose={onClose}
                detailTitle="pxlkt"
            >
                <div>inspector</div>
            </PaperSplit>
        ));
        setWidth(400);
        expect(screen.getByRole("dialog", { name: "pxlkt" })).toBeDefined();
        expect(screen.getByText("inspector")).toBeDefined();

        await fireEvent.click(screen.getByLabelText("Close modal"));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(active()).toBe(false);
    });
});
