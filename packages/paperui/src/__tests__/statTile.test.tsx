import { describe, test, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PaperStatTile } from "../components/PaperStatTile";

describe("PaperStatTile", () => {
    test("renders value, label and icon", () => {
        render(() => (
            <PaperStatTile icon="favorite" label="Health" value="18 / 20" />
        ));
        expect(screen.getByText("18 / 20")).toBeDefined();
        expect(screen.getByText("Health")).toBeDefined();
        expect(screen.getByText("favorite")).toBeDefined();
    });

    test("a tone exposes the role variables for the icon chip and meter", () => {
        const { container } = render(() => (
            <PaperStatTile
                icon="restaurant"
                label="Food"
                value="16 / 20"
                tone="warning"
                meter={{ value: 16, max: 20 }}
            />
        ));
        const tile = container.firstElementChild as HTMLElement;
        expect(tile.style.getPropertyValue("--role-base")).toBe("var(--paper-warning)");
        const meter = screen.getByRole("progressbar");
        expect(meter.getAttribute("aria-valuenow")).toBe("16");
        expect((meter as HTMLElement).style.getPropertyValue("--role-base")).toBe(
            "var(--paper-warning)",
        );
    });

    test("a meter can override the tile tone", () => {
        render(() => (
            <PaperStatTile
                icon="favorite"
                label="Health"
                value="4 / 20"
                tone="warning"
                meter={{ value: 4, max: 20, variant: "danger" }}
            />
        ));
        const meter = screen.getByRole("progressbar");
        expect((meter as HTMLElement).style.getPropertyValue("--role-base")).toBe(
            "var(--paper-danger)",
        );
    });
});
