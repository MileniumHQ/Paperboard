import { describe, test, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PaperProgress } from "../components/PaperProgress";

describe("PaperProgress role variants", () => {
    test("defaults to the primary fill with no role override", () => {
        render(() => <PaperProgress value={40} />);
        const bar = screen.getByRole("progressbar");
        expect((bar as HTMLElement).style.getPropertyValue("--role-base")).toBe("");
    });

    test("a variant exposes the role variables and keeps the readout", () => {
        render(() => <PaperProgress value={30} max={100} variant="danger" />);
        const bar = screen.getByRole("progressbar");
        expect(bar.getAttribute("aria-valuenow")).toBe("30");
        expect((bar as HTMLElement).style.getPropertyValue("--role-base")).toBe(
            "var(--paper-danger)",
        );
    });
});
