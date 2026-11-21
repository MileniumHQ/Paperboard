import { describe, expect, test } from "bun:test";
import { createHostAuthorityCheck } from "../src/server/hostAuthority";

// A Host header that does not parse is refused, never resolved or let through.
describe("the host authority check refuses malformed authorities", () => {
	const loopback = createHostAuthorityCheck("127.0.0.1");

	test("a loopback listener accepts loopback authorities", () => {
		for (const ok of ["127.0.0.1", "127.0.0.1:3000", "localhost:8080", "[::1]:3000", "app.localhost"]) expect(loopback(ok)).toBe(true);
	});

	test("malformed authorities are refused", () => {
		for (const bad of ["[", "host:99999", "[::1", "127.0.0.1:abc", "a b", "127.0.0.1/x", "user@127.0.0.1", "127.0.0.1#x", "", undefined])
			expect(loopback(bad)).toBe(false);
	});

	test("a foreign name is refused on a loopback listener", () => {
		expect(loopback("example.com")).toBe(false);
		expect(loopback("rebound.example:3000")).toBe(false);
	});
});
