import { describe, expect, test } from "vitest";
import { createSignal, onMount } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { PaperPage, type PaperSpacing } from "../index";

// Inventory: Layout and navigation — PaperPage restyle keeps children mounted.
describe("PaperPage restyle", () => {
    test("changing a style prop never remounts children, even one that restyles the page on mount", () => {
        const [gap, setGap] = createSignal<PaperSpacing>("full");
        let mounts = 0;
        function Child() {
            onMount(() => {
                mounts++;
                // guard: a remount loop would otherwise never end
                if (mounts > 5) throw new Error("PaperPage remounted its child more than five times");
                setGap("half");
            });
            return <span>child</span>;
        }

        render(() => (
            <PaperPage gap={gap()} padding="full">
                <Child />
            </PaperPage>
        ));
        const child = screen.getByText("child");
        const page = child.parentElement!;
        expect(mounts).toBe(1);
        expect(page.style.gap).toBe("var(--paper-uigap-half)");

        setGap("double");
        expect(page.style.gap).toBe("var(--paper-uigap-double)");
        expect(mounts).toBe(1);
        expect(screen.getByText("child")).toBe(child);
    });
});
