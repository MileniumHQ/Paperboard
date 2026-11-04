import { describe, test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import { PaperText } from "../components/PaperText";

const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });

afterEach(() => {
    vi.restoreAllMocks();
    setClipboard(undefined);
});

describe("PaperText anchor link", () => {
    test("copies the link to the text and says so", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard({ writeText });
        const { getByRole } = render(() => <PaperText id="usage">Usage</PaperText>);
        fireEvent.click(getByRole("button", { name: "Copy link" }));
        await waitFor(() => getByRole("button", { name: "Copied link" }));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}#usage`);
        expect(window.location.hash).toBe("#usage");
    });

    test("a denied clipboard is reported on the button, not only in the console", async () => {
        setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
        document.execCommand = vi.fn().mockReturnValue(false);
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        window.history.replaceState(null, "", "#");
        const { getByRole } = render(() => <PaperText id="behavior">Behavior</PaperText>);
        fireEvent.click(getByRole("button", { name: "Copy link" }));
        const button = await waitFor(() => getByRole("button", { name: "Copy failed" }));
        expect(button.textContent).toBe("error");
        expect(window.location.hash).not.toBe("#behavior");
    });
});
