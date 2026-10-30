import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PaperLoader } from "../components/PaperLoader";

describe("PaperLoader", () => {
    test("a small loader's label is smaller text than a medium one's", () => {
        render(() => (
            <>
                <PaperLoader size="small" loaderStatus="waiting" label="Small step" />
                <PaperLoader loaderStatus="waiting" label="Medium step" />
            </>
        ));
        expect(screen.getByText("Small step").style.fontSize).toBe("var(--paper-text-size-2)");
        expect(screen.getByText("Medium step").style.fontSize).toBe("var(--paper-text-size-4)");
    });

    test("a delayed loader stays off screen until its delay passes", () => {
        vi.useFakeTimers();
        try {
            render(() => <PaperLoader loaderStatus="indeterminate" delay={400} label="Loading servers" />);
            expect(screen.queryByText("Loading servers")).toBeNull();
            vi.advanceTimersByTime(399);
            expect(screen.queryByText("Loading servers")).toBeNull();
            vi.advanceTimersByTime(1);
            expect(screen.getByText("Loading servers")).toBeDefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
