import { describe, test, expect, vi, afterEach } from "vitest";
import { copyText, pasteText } from "../utils/clipboard";

const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });

afterEach(() => {
    vi.restoreAllMocks();
    setClipboard(undefined);
});

describe("copyText", () => {
    test("uses the async clipboard when it answers", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard({ writeText });
        expect(await copyText("hello")).toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    test("falls back to execCommand when the async clipboard is denied", async () => {
        setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
        document.execCommand = vi.fn().mockReturnValue(true);
        vi.spyOn(console, "debug").mockImplementation(() => {});
        expect(await copyText("hello")).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith("copy");
    });
});

describe("pasteText", () => {
    test("uses the async clipboard when it answers", async () => {
        const readText = vi.fn().mockResolvedValue("from clipboard");
        setClipboard({ readText });
        expect(await pasteText()).toBe("from clipboard");
        expect(readText).toHaveBeenCalled();
    });

    test("falls back to execCommand when the async clipboard is denied", async () => {
        setClipboard({ readText: vi.fn().mockRejectedValue(new Error("denied")) });
        document.execCommand = vi.fn().mockImplementation(() => {
            const textarea = document.querySelector("textarea");
            if (textarea) textarea.value = "from fallback";
            return true;
        });
        vi.spyOn(console, "debug").mockImplementation(() => {});
        expect(await pasteText()).toBe("from fallback");
        expect(document.execCommand).toHaveBeenCalledWith("paste");
        expect(document.querySelector("textarea")).toBeNull();
    });

    test("returns null when both paths fail so unavailable is not read as empty", async () => {
        setClipboard(undefined);
        document.execCommand = vi.fn().mockReturnValue(false);
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await pasteText()).toBeNull();
    });
});
