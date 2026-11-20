// What the terminal decides on its own before anything reaches the system
// browser: which links open.
import { describe, expect, test } from "bun:test";
import { linkOpens } from "../src/lib/screen";

describe("links open in the system browser only when safe", () => {
    test("https anywhere, http only on this computer", () => {
        expect(linkOpens("https://example.com/a?b=c")).toBe(true);
        expect(linkOpens("http://localhost:5173/")).toBe(true);
        expect(linkOpens("http://app.localhost/")).toBe(true);
        expect(linkOpens("http://127.0.0.1:8080")).toBe(true);
        expect(linkOpens("http://[::1]:3000/")).toBe(true);
    });

    test("anything else stays in the terminal", () => {
        expect(linkOpens("http://example.com/")).toBe(false);
        // a host that only starts like a loopback one
        expect(linkOpens("http://localhost.example.com/")).toBe(false);
        expect(linkOpens("http://127.0.0.1.example.com/")).toBe(false);
        expect(linkOpens("file:///etc/passwd")).toBe(false);
        expect(linkOpens("javascript:alert(1)")).toBe(false);
        expect(linkOpens("ssh://host")).toBe(false);
        expect(linkOpens("not a url")).toBe(false);
    });
});
