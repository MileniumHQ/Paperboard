// Phones buzz under the finger. Only named kinds play, and a framed
// document reports instead of vibrating (browsers refuse vibrate in cross-origin frames).
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HAPTIC_EVENT, haptic, playHaptic, setHapticPlayer } from "../utils/haptics";
import { PaperEffect } from "../components/PaperEffect";
import { PaperToggle } from "../components/PaperToggle";
import { PaperRange } from "../components/PaperRange";
import { createSwipeBack, swipeFromFrame } from "../utils/swipeBack";
import { installTouchHold } from "../utils/touchHold";

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
});
afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "vibrate");
});

describe("haptics", () => {
    it("plays only kinds in the table", () => {
        expect(playHaptic("selection")).toBe(true);
        expect(vibrate).toHaveBeenLastCalledWith([5]);
        expect(playHaptic("forever")).toBe(false);
        expect(playHaptic([10000])).toBe(false);
        expect(playHaptic("toString")).toBe(false);
        expect(vibrate).toHaveBeenCalledTimes(1);
    });

    it("a native host's player plays named kinds instead of the vibrator", () => {
        const played: string[] = [];
        setHapticPlayer((kind) => { played.push(kind); return true; });
        try {
            expect(playHaptic("paper")).toBe(true);
            expect(playHaptic("forever")).toBe(false);
            haptic("success");
        } finally {
            setHapticPlayer(null);
        }
        expect(played).toEqual(["paper", "success"]);
        expect(vibrate).not.toHaveBeenCalled();
        expect(playHaptic("light")).toBe(true);
        expect(vibrate).toHaveBeenLastCalledWith([10]);
    });

    it("a framed document reports the kind on window instead of vibrating", () => {
        const parent = vi.spyOn(window, "parent", "get").mockReturnValue({} as Window);
        const reported: unknown[] = [];
        const listen = (e: Event) => reported.push((e as CustomEvent).detail);
        window.addEventListener(HAPTIC_EVENT, listen);
        try {
            haptic("light");
        } finally {
            window.removeEventListener(HAPTIC_EVENT, listen);
            parent.mockRestore();
        }
        expect(reported).toEqual([{ kind: "light" }]);
        expect(vibrate).not.toHaveBeenCalled();
    });
});

describe("PaperEffect press", () => {
    const tap = (el: Element, pointerType = "touch") => {
        fireEvent.pointerDown(el, { pointerId: 3, pointerType });
        fireEvent.pointerUp(el, { pointerId: 3, pointerType });
    };

    it("a finger lifted where it pressed feels the paper; a danger paper thuds", () => {
        const { getByText } = render(() => <>
            <PaperEffect>plain</PaperEffect>
            <PaperEffect variant="danger">danger</PaperEffect>
        </>);
        tap(getByText("plain"));
        expect(vibrate).toHaveBeenLastCalledWith([12, 45, 5]);
        tap(getByText("danger"));
        expect(vibrate).toHaveBeenLastCalledWith([24, 35, 10]);
    });

    it("a press that became a scroll, a mouse click, or a disabled paper feels nothing", () => {
        const { getByText } = render(() => <>
            <PaperEffect>scrolled</PaperEffect>
            <PaperEffect>clicked</PaperEffect>
            <PaperEffect disabled>off</PaperEffect>
            <PaperEffect><button disabled>inner</button></PaperEffect>
        </>);
        const scrolled = getByText("scrolled");
        fireEvent.pointerDown(scrolled, { pointerId: 3, pointerType: "touch" });
        fireEvent.pointerCancel(scrolled, { pointerId: 3, pointerType: "touch" });
        fireEvent.pointerUp(scrolled, { pointerId: 3, pointerType: "touch" });
        tap(getByText("clicked"), "mouse");
        tap(getByText("off"));
        tap(getByText("inner").parentElement!);
        expect(vibrate).not.toHaveBeenCalled();
    });
});

describe("controls", () => {
    it("a switch buzzes as it flips", () => {
        const { getByRole } = render(() => <PaperToggle aria-label="Mute" />);
        fireEvent.click(getByRole("switch"));
        expect(vibrate).toHaveBeenCalledTimes(1);
    });

    it("a slider ticks at each of a few stops, and glides silently through many", () => {
        const drag = (step: number) => {
            const result = render(() => {
                const [value, setValue] = createSignal(0);
                return <PaperRange aria-label={`step ${step}`} value={value()} step={step} onInput={setValue} />;
            });
            const slider = result.getByRole("slider");
            const track = slider.firstElementChild as HTMLElement;
            vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
            fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
            for (const x of [5, 30, 31, 60, 90]) fireEvent.pointerMove(slider, { pointerId: 1, clientX: x, clientY: 0 });
            fireEvent.pointerUp(slider, { pointerId: 1, clientX: 90, clientY: 0 });
            result.unmount();
        };
        drag(1);
        expect(vibrate).not.toHaveBeenCalled();
        // 0 → 0, 25, 25, 50, 100: three stops crossed
        drag(25);
        expect(vibrate).toHaveBeenCalledTimes(3);
    });
});

describe("gestures", () => {
    it("a back swipe buzzes when it goes back, not when it springs back", () => {
        const page = document.createElement("div");
        const frame = document.createElement("iframe");
        page.append(frame);
        document.body.append(page);
        const onBack = vi.fn();
        const dispose = createRoot((dispose) => {
            createSwipeBack({ width: () => 400, onBack, el: () => page, active: () => true });
            return dispose;
        });
        try {
            swipeFromFrame(frame, { phase: "end", dx: 20, velocity: 0 });
            expect(vibrate).not.toHaveBeenCalled();
            swipeFromFrame(frame, { phase: "end", dx: 300, velocity: 0 });
            expect(onBack).toHaveBeenCalledTimes(1);
            expect(vibrate).toHaveBeenCalledWith([10]);
        } finally {
            dispose();
            page.remove();
        }
    });

    it("a held finger buzzes when it opens a context menu", () => {
        vi.useFakeTimers();
        const uninstall = installTouchHold();
        const item = document.createElement("div");
        document.body.append(item);
        const touch = (type: string, touches: object[]) =>
            item.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches, changedTouches: [{ identifier: 1, clientX: 5, clientY: 5 }] }));
        try {
            item.addEventListener("contextmenu", (e) => e.preventDefault());
            touch("touchstart", [{ identifier: 1, clientX: 5, clientY: 5 }]);
            vi.advanceTimersByTime(499);
            expect(vibrate).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);
            expect(vibrate).toHaveBeenCalledWith([18]);
            touch("touchend", []);
        } finally {
            uninstall();
            item.remove();
            vi.useRealTimers();
        }
    });
});
