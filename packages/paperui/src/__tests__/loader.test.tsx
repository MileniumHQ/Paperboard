import { describe, expect, test } from "vitest";
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
});
