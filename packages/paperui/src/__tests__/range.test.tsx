import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, it, expect, vi, afterEach } from "vitest";
import { PaperRange, clampToStep } from "../components/PaperRange";

afterEach(cleanup);

function rect(el: Element, r: { left: number; top: number; width: number; height: number }) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        ...r,
        x: r.left,
        y: r.top,
        right: r.left + r.width,
        bottom: r.top + r.height,
        toJSON: () => r,
    } as DOMRect);
}

function setup(props: Partial<Parameters<typeof PaperRange>[0]> = {}) {
    const onInput = vi.fn();
    const onChange = vi.fn();
    const utils = render(() => {
        const [value, setValue] = createSignal(props.value ?? 50);
        return (
            <PaperRange
                aria-label="Level"
                {...props}
                value={value()}
                onInput={(v) => {
                    setValue(v);
                    onInput(v);
                }}
                onChange={onChange}
            />
        );
    });
    const slider = utils.getByRole("slider", { name: "Level" });
    const track = slider.firstElementChild as HTMLElement;
    const bar = track.firstElementChild as HTMLElement;
    return { ...utils, slider, track, bar, onInput, onChange };
}

describe("PaperRange", () => {
    it("exposes slider semantics and draws the value like PaperProgress", () => {
        const { slider, track, bar } = setup({ value: 25, valueText: (v) => `${v}%` });
        expect(slider.getAttribute("aria-valuenow")).toBe("25");
        expect(slider.getAttribute("aria-valuemin")).toBe("0");
        expect(slider.getAttribute("aria-valuemax")).toBe("100");
        expect(slider.getAttribute("aria-valuetext")).toBe("25%");
        expect(slider.getAttribute("aria-orientation")).toBe("horizontal");
        expect(track.className).toContain("PaperProgress");
        expect(bar.style.width).toBe("25%");
    });

    it("steps with arrows, pages with PageUp/PageDown, and jumps with Home/End", () => {
        const { slider, onInput, onChange } = setup({ value: 50, step: 5 });
        fireEvent.keyDown(slider, { key: "ArrowRight" });
        expect(onInput).toHaveBeenLastCalledWith(55);
        expect(onChange).toHaveBeenLastCalledWith(55);
        fireEvent.keyDown(slider, { key: "ArrowDown" });
        expect(onInput).toHaveBeenLastCalledWith(50);
        fireEvent.keyDown(slider, { key: "PageUp" });
        expect(onInput).toHaveBeenLastCalledWith(60);
        fireEvent.keyDown(slider, { key: "End" });
        expect(onInput).toHaveBeenLastCalledWith(100);
        fireEvent.keyDown(slider, { key: "ArrowUp" });
        expect(onInput).toHaveBeenLastCalledWith(100);
        fireEvent.keyDown(slider, { key: "Home" });
        expect(onInput).toHaveBeenLastCalledWith(0);
    });

    it("drags horizontally, reporting input live and change once on release", () => {
        const { slider, track, bar, onInput, onChange } = setup({ value: 0 });
        rect(track, { left: 100, top: 0, width: 200, height: 6 });
        fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 150, clientY: 0 });
        expect(onInput).toHaveBeenLastCalledWith(25);
        fireEvent.pointerMove(slider, { pointerId: 1, clientX: 250, clientY: 0 });
        expect(onInput).toHaveBeenLastCalledWith(75);
        expect(bar.style.width).toBe("75%");
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.pointerMove(slider, { pointerId: 1, clientX: 900, clientY: 0 });
        expect(onInput).toHaveBeenLastCalledWith(100);
        fireEvent.pointerUp(slider, { pointerId: 1, clientX: 900, clientY: 0 });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(100);
        fireEvent.pointerMove(slider, { pointerId: 1, clientX: 100, clientY: 0 });
        expect(onInput).toHaveBeenLastCalledWith(100);
    });

    it("drags vertically from the bottom up", () => {
        const { slider, track, bar, onInput } = setup({ value: 0, orientation: "vertical", min: 0, max: 1, step: 0.05 });
        expect(slider.getAttribute("aria-orientation")).toBe("vertical");
        rect(track, { left: 0, top: 0, width: 6, height: 100 });
        fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 0, clientY: 20 });
        expect(onInput).toHaveBeenLastCalledWith(0.8);
        expect(bar.style.height).toBe("80%");
        fireEvent.keyDown(slider, { key: "ArrowUp" });
        expect(onInput).toHaveBeenLastCalledWith(0.85);
    });

    it("ignores pointer and keys while disabled and leaves the tab order", () => {
        const { slider, track, onInput } = setup({ disabled: true });
        rect(track, { left: 0, top: 0, width: 100, height: 6 });
        expect(slider.getAttribute("aria-disabled")).toBe("true");
        expect(slider.tabIndex).toBe(-1);
        fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 10, clientY: 0 });
        fireEvent.keyDown(slider, { key: "ArrowRight" });
        expect(onInput).not.toHaveBeenCalled();
    });

    it("snaps to the step without float drift and clamps to the bounds", () => {
        expect(clampToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
        expect(clampToStep(7, 0, 10, 5)).toBe(5);
        expect(clampToStep(8, 0, 10, 5)).toBe(10);
        expect(clampToStep(-3, 0, 10, 1)).toBe(0);
        expect(clampToStep(12, 0, 10, 1)).toBe(10);
    });
});
