// The runtime's fetch check follows the fixed scheme rule: https anywhere,
// http only to this machine. The daemon CSP stays the enforcement boundary;
// this is the honest refusal.
import { describe, expect, it } from "bun:test";
import { fetchRefusal } from "../src/lib/fetchPolicy";

describe("fetchRefusal", () => {
    it("allows https anywhere and http only to loopback", () => {
        expect(fetchRefusal("https://anything.dev/x")).toBeNull();
        expect(fetchRefusal("http://localhost:8080/x")).toBeNull();
        expect(fetchRefusal("http://127.0.0.1/x")).toBeNull();
        expect(fetchRefusal("http://[::1]:8080/x")).toBeNull();
        expect(fetchRefusal("http://example.com/x")).toMatch(/loopback/);
    });

    it("refuses other schemes and malformed urls", () => {
        expect(fetchRefusal("ftp://example.com")).toMatch(/only https/);
        expect(fetchRefusal("file:///etc/passwd")).toMatch(/only https/);
        expect(fetchRefusal("not a url")).toMatch(/malformed/);
    });
});
