import { describe, expect, test } from "bun:test";
import { opensExternally } from "../../src/main/communication/shellGuard";

// what a page may hand the system browser: a scheme the system would run a
// program for must never pass
describe("links that open in the system browser", () => {
    test("https anywhere, http only on this computer, nothing else", () => {
        for (const url of ["https://paperboard.dev/docs", "http://localhost:5173/", "http://127.0.0.1:8080/x", "http://[::1]:3000", "http://app.localhost/"]) {
            expect({ url, opens: opensExternally(url) }).toEqual({ url, opens: true });
        }
        for (const url of [
            "http://example.com/",
            "http://localhost.example.com/",
            "http://127.0.0.1.example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "smb://server/share",
            "vscode://file/x",
            "not a url",
        ]) {
            expect({ url, opens: opensExternally(url) }).toEqual({ url, opens: false });
        }
    });
});
