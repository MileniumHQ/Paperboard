import { describe, test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperPageHeader } from "../components/PaperPageHeader";

describe("PaperPageHeader", () => {
    test("renders title, subtitle, icon, and trailing actions", () => {
        const { container, getByText } = render(() => (
            <PaperPageHeader
                icon="public"
                title="Worlds"
                subtitle="Switch the active world"
            >
                <button type="button">Refresh</button>
            </PaperPageHeader>
        ));

        expect(getByText("Worlds")).toBeTruthy();
        expect(getByText("Switch the active world")).toBeTruthy();
        expect(
            container.querySelector('[class*="iconChip"]')?.textContent,
        ).toBe("public");
        expect(getByText("Refresh")).toBeTruthy();
    });

    test("omits subtitle and actions when not provided", () => {
        const { container } = render(() => (
            <PaperPageHeader icon="tune" title="Options" />
        ));

        expect(container.textContent).toContain("Options");
        expect(container.querySelector('[class*="actions"]')).toBeNull();
    });
});
