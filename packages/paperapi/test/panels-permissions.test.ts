// install-sheet permission facts (bun test): the registry merge carries
// manifest-declared permission labels through to PanelItem (clipped,
// never invented), so the install dialog surfaces them at the moment
// of trust. Records without declarations read as undefined.
import { describe, test, expect, afterEach } from "bun:test";
import { panelsApi } from "../src/panels";

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

describe("panelsApi.registry permission facts", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test("manifest permissions survive the merge, clipped and string-only", async () => {
        globalThis.fetch = async () =>
            jsonResponse(200, {
                "p.one": {
                    name: "One",
                    manifest: {
                        permissions: ["terminal.create", 42, "x".repeat(100)],
                    },
                },
                "p.two": { name: "Two" },
            });
        const items = await panelsApi.registry();
        const one = items.find((p) => p.id === "p.one");
        const two = items.find((p) => p.id === "p.two");
        expect(one?.permissions).toEqual(["terminal.create", "x".repeat(64)]);
        expect(two?.permissions).toBeUndefined();
    });
});
