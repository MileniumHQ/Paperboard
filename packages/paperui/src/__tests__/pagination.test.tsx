import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { PaperPagination } from "../components/PaperPagination";

function pageButton(page: number) {
    return screen.getByRole("button", { name: `Page ${page}` });
}

describe("PaperPagination", () => {
    test("renders nothing for a single page", () => {
        const { container } = render(() => (
            <PaperPagination page={1} pageCount={1} />
        ));

        expect(container.querySelector("nav")).toBeNull();
    });

    test("renders every page when they all fit", () => {
        render(() => <PaperPagination page={2} pageCount={4} />);

        expect(pageButton(1)).toBeDefined();
        expect(pageButton(4)).toBeDefined();
        expect(screen.queryByText("…")).toBeNull();
    });

    test("collapses skipped runs into an ellipsis", () => {
        const { container } = render(() => (
            <PaperPagination page={5} pageCount={20} />
        ));

        expect(pageButton(1)).toBeDefined();
        expect(pageButton(20)).toBeDefined();
        expect(pageButton(4)).toBeDefined();
        expect(pageButton(6)).toBeDefined();
        // pages 2-3 and 7-19 collapse into gaps
        expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
        expect(screen.queryByRole("button", { name: "Page 10" })).toBeNull();
    });

    test("marks the current page and reports clicks", () => {
        const onPageChange = vi.fn();
        render(() => (
            <PaperPagination page={2} pageCount={5} onPageChange={onPageChange} />
        ));

        expect(pageButton(2).getAttribute("aria-current")).toBe("page");

        fireEvent.click(pageButton(3));
        expect(onPageChange).toHaveBeenCalledWith(3);
    });

    test("does not report a click on the current page", () => {
        const onPageChange = vi.fn();
        render(() => (
            <PaperPagination page={2} pageCount={5} onPageChange={onPageChange} />
        ));

        fireEvent.click(pageButton(2));
        expect(onPageChange).not.toHaveBeenCalled();
    });

    test("previous and next move one page and stop at the ends", () => {
        const onPageChange = vi.fn();
        const { unmount } = render(() => (
            <PaperPagination page={1} pageCount={3} onPageChange={onPageChange} />
        ));

        const previous = screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
        expect(previous.disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Next page" }));
        expect(onPageChange).toHaveBeenCalledWith(2);

        unmount();
        render(() => <PaperPagination page={3} pageCount={3} onPageChange={onPageChange} />);
        expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    });

    test("disables every control when disabled", () => {
        const onPageChange = vi.fn();
        render(() => (
            <PaperPagination page={2} pageCount={5} disabled onPageChange={onPageChange} />
        ));

        fireEvent.click(pageButton(3));
        expect(onPageChange).not.toHaveBeenCalled();
        expect((pageButton(3) as HTMLButtonElement).disabled).toBe(true);
    });

    test("clamps a current page outside the range", () => {
        render(() => <PaperPagination page={99} pageCount={3} />);

        expect(pageButton(3).getAttribute("aria-current")).toBe("page");
        expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    });
});
