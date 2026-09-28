import { describe, expect, test } from "bun:test";
import { apiFetch, PAPERBOARD_USER_AGENT } from "../src/lib/userAgent";

// Modrinth and PaperMC both require a uniquely identifying User-Agent and may
// block generic clients, so every outbound request must carry this one.
describe("outbound User-Agent", () => {
    test("identifies Paperboard and keeps caller headers", async () => {
        const calls: RequestInit[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (_input, init) => {
            calls.push(init ?? {});
            return new Response("{}", { status: 200 });
        }) as typeof fetch;
        try {
            await apiFetch("https://api.modrinth.com/v2/test");
            await apiFetch("https://fill.papermc.io/v3/projects/paper", {
                headers: { Accept: "application/json" },
            });
        } finally {
            globalThis.fetch = original;
        }

        expect(calls).toHaveLength(2);
        for (const init of calls) {
            expect(new Headers(init.headers).get("User-Agent")).toBe(
                PAPERBOARD_USER_AGENT,
            );
        }
        expect(new Headers(calls[1].headers).get("Accept")).toBe(
            "application/json",
        );
    });

    test("does not override a caller's own User-Agent", async () => {
        const original = globalThis.fetch;
        let seen: string | null = null;
        globalThis.fetch = (async (_input, init) => {
            seen = new Headers(init?.headers).get("User-Agent");
            return new Response("");
        }) as typeof fetch;
        try {
            await apiFetch("https://example.invalid", {
                headers: { "User-Agent": "custom/1.0" },
            });
        } finally {
            globalThis.fetch = original;
        }

        expect(seen).toBe("custom/1.0");
    });
});
