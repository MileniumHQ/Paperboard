import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { copyText, PaperCode, PaperCopyButton, PaperText, pasteText } from "../index";

// A document where both clipboard paths refuse, as in a sandboxed panel
// frame: the async clipboard rejects and execCommand reports failure.
// jsdom has neither API, so the test installs the refusing versions.
const denied = () => Promise.reject(new DOMException("Clipboard access denied", "NotAllowedError"));

beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: denied, readText: denied },
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    // copyText logs each failed path; the log is part of failing loudly
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
    vi.restoreAllMocks();
});

// Inventory: Content, files and console — Failures are shown, not swallowed (clipboard).
describe("clipboard failures are shown", () => {
    test("copyText reports false and pasteText null, not an empty string, when both paths fail", async () => {
        await expect(copyText("secret")).resolves.toBe(false);
        await expect(pasteText()).resolves.toBeNull();
        expect(console.error).toHaveBeenCalled();
    });

    test("PaperCopyButton says the copy failed", async () => {
        render(() => <PaperCopyButton text="token" label="Copy token" />);
        fireEvent.click(screen.getByRole("button", { name: /Copy token/ }));
        await waitFor(() => expect(screen.getByRole("button").textContent).toContain("Couldn't copy"));
        expect(screen.getByRole("button").getAttribute("title")).toBe("Couldn't copy");
    });

    test("PaperCode's copy button says the copy failed", async () => {
        render(() => <PaperCode block>{"java -jar server.jar"}</PaperCode>);
        fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy());
    });

    test("a PaperText anchor says the copy failed and leaves the address alone", async () => {
        const before = window.location.href;
        render(() => (
            <PaperText as="h2" id="install">
                Install
            </PaperText>
        ));
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy());
        expect(window.location.href).toBe(before);
    });
});
