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

    test("inline code without a language is plain text, not highlighted", () => {
        const { container } = render(() => <PaperCode>Timed out with no response</PaperCode>);
        const code = container.querySelector("code");
        expect(code?.textContent).toBe("Timed out with no response");
        expect(code?.querySelector(".token")).toBeNull();
    });
    test("inline code with a language is highlighted", () => {
        const { container } = render(() => <PaperCode language="tsx">const a = 1;</PaperCode>);
        expect(container.querySelector("code .token")).not.toBeNull();
    });
    test("a text block is shown as written", () => {
        const { container } = render(() => <PaperCode block language="text">return with as</PaperCode>);
        expect(container.querySelector("pre code .token")).toBeNull();
    });
});
