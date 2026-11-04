import { describe, test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import { PaperCode } from "../components/PaperCode";

afterEach(() => vi.restoreAllMocks());

describe("PaperCode copy", () => {
    test("copies the block text and says so", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const { getByRole } = render(() => <PaperCode block>echo hi</PaperCode>);
        fireEvent.click(getByRole("button", { name: "Copy code" }));
        await waitFor(() => getByRole("button", { name: "Copied" }));
        expect(writeText).toHaveBeenCalledWith("echo hi");
    });

    test("a denied clipboard is reported, not shown as copied", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
            configurable: true,
        });
        document.execCommand = vi.fn().mockReturnValue(false);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { getByRole } = render(() => <PaperCode block>echo hi</PaperCode>);
        fireEvent.click(getByRole("button", { name: "Copy code" }));
        await waitFor(() => getByRole("button", { name: "Copy failed" }));
    });
    test("a block names its language on the <pre>, so text exports keep it", () => {
        const { container } = render(() => (
            <PaperCode block language="tsx">const a = 1;</PaperCode>
        ));
        expect(container.querySelector("pre")?.getAttribute("data-language")).toBe("tsx");
    });
});
