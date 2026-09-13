import { describe, it, expect } from "bun:test";
import { semverGt, RingBuffer, resolveRegistryUrl } from "../papercrane/util";

describe("semverGt", () => {
    it("compares major/minor/patch", () => {
        expect(semverGt("2.0.0", "1.9.9")).toBe(true);
        expect(semverGt("1.1.0", "1.0.9")).toBe(true);
        expect(semverGt("1.0.1", "1.0.0")).toBe(true);
        expect(semverGt("1.0.0", "1.0.0")).toBe(false);
        expect(semverGt("1.0.0", "1.0.1")).toBe(false);
    });

    it("strips non-numeric prefixes (v-prefix)", () => {
        expect(semverGt("v2.0.0", "1.0.0")).toBe(true);
        expect(semverGt("v1.0.0", "v1.0.0")).toBe(false);
    });

    it("handles missing patch segments", () => {
        expect(semverGt("1.1", "1.0.5")).toBe(true);
        expect(semverGt("1.0", "1.0.3")).toBe(false);
    });

    it("handles empty/garbage as zero", () => {
        expect(semverGt("", "0")).toBe(false);
        expect(semverGt("0.0.1", "")).toBe(true);
    });
});

describe("RingBuffer", () => {
    it("returns pushed content", () => {
        const rb = new RingBuffer(100);
        rb.push("hello ");
        rb.push("world");
        expect(rb.getAll()).toBe("hello world");
    });

    it("evicts oldest chunks beyond the budget (chunk granularity)", () => {
        const rb = new RingBuffer(15);
        rb.push("aaaaa");
        rb.push("bbbbbbbbbb"); // exactly full
        rb.push("c"); // evicts the first chunk entirely, not partial chars
        expect(rb.getAll()).toBe("bbbbbbbbbbc");
    });

    it("never exceeds max size", () => {
        const rb = new RingBuffer(50);
        for (let i = 0; i < 100; i++) rb.push("x".repeat(10));
        expect(rb.size).toBeLessThanOrEqual(60); // at most one chunk over budget
    });

    it("handles a single chunk larger than the budget", () => {
        const rb = new RingBuffer(4);
        rb.push("toolongstring"); // whole chunk is evicted — cannot split
        expect(rb.getAll()).toBe("");
        expect(rb.size).toBe(0);
    });
});

describe("resolveRegistryUrl", () => {
    it("honors ORIGAMI_REGISTRY_URL outside production", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "development", ORIGAMI_REGISTRY_URL: "http://dev-registry" },
            argv: [],
        });
        expect(url).toBe("http://dev-registry");
    });

    it("ignores the env override in a production daemon", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "production", ORIGAMI_REGISTRY_URL: "http://evil.example" },
            argv: [],
        });
        expect(url).toBe("https://origami.ariapis.com");
    });

    it("honors the override in production only with the explicit flag", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "production", ORIGAMI_REGISTRY_URL: "http://flagged.example" },
            argv: ["--allow-registry-override"],
        });
        expect(url).toBe("http://flagged.example");
    });

    it("falls back to the default when no override is set", () => {
        const url = resolveRegistryUrl({ env: {}, argv: [] });
        expect(url).toBe("https://origami.ariapis.com");
    });
});
