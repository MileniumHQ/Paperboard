// bounded registry index fetch: refuses oversized payloads and times out
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fetchRegistryIndex } from "../src/config";

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

describe("fetchRegistryIndex (bounded)", () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
        // deterministic url: the constant is overridable via env
        const url = "https://origami.ariapis.com";
        process.env.ORIGAMI_REGISTRY_URL = url;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        delete process.env.ORIGAMI_REGISTRY_URL;
    });

    test("parses the panel index from the happy path", async () => {
        globalThis.fetch = async () =>
            jsonResponse(200, { "panel.one": { name: "One", version: "1.0.0" } });
        const data = await fetchRegistryIndex();
        expect(data["panel.one"]).toMatchObject({ name: "One" });
    });

    test("refuses an HTTP failure with no boards fallback", async () => {
        const calls: string[] = [];
        globalThis.fetch = async (input: any) => {
            calls.push(String(input));
            return jsonResponse(404, {});
        };
        await expect(fetchRegistryIndex()).rejects.toThrow(
            /Registry returned HTTP 404/,
        );
        expect(calls.some((u) => u.includes("/panels/index.json"))).toBe(true);
        expect(calls.some((u) => u.includes("/boards/"))).toBe(false);
    });

    test("refuses an oversized registry index", async () => {
        globalThis.fetch = async () =>
            jsonResponse(200, { big: "x".repeat(1024 * 1024 * 2) });
        await expect(fetchRegistryIndex(5_000, 1024)).rejects.toThrow(
            /exceeds .* bytes; refusing to parse/,
        );
    });

    test("aborts a streaming oversized index before it finishes buffering", async () => {
        // lying header: claims 8 bytes, streams 2MB. The cap must fire at the
        // stream boundary, not after the whole body is buffered.
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("x".repeat(1024 * 1024 * 2)));
                controller.close();
            },
        });
        globalThis.fetch = async () =>
            new Response(stream, {
                status: 200,
                headers: { "content-length": "8" },
            });
        await expect(fetchRegistryIndex(5_000, 1024)).rejects.toThrow(
            /exceeds .* bytes; refusing to parse/,
        );
    });

    test("times out a hung registry fetch via abort", async () => {
        globalThis.fetch = async (_input: any, init?: any) => {
            // never resolves unless aborted; the bound aborts and rejects
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(new Error("AbortError")),
                );
            });
        };
        await expect(fetchRegistryIndex(20)).rejects.toThrow("AbortError");
    });
});