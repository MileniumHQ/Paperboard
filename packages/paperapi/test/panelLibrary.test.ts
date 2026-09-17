import { test, expect } from "bun:test";
import { panelsApi } from "../src/panels";

test("registry merge preserves installed provenance and version without inventing publisher facts", async () => {
    const list = panelsApi.list;
    const fetch = globalThis.fetch;
    try {
        panelsApi.list = async () => [{ id: "panel.a", name: "A", version: "0.1.0", installSource: "dev", isLinked: true }];
        globalThis.fetch = async () => Response.json({ "panel.a": { name: "A", version: "0.2.0" } });
        const [panel] = await panelsApi.registry("local");
        expect(panel).toMatchObject({ installSource: "dev", isLinked: true, installedVersion: "0.1.0", version: "0.2.0", isInstalled: true });
        expect(panel.publisher).toBeUndefined();
        globalThis.fetch = async () => new Response("unavailable", { status: 503 });
        await expect(panelsApi.registry("local")).rejects.toThrow(/503/);
    } finally { panelsApi.list = list; globalThis.fetch = fetch; }
});
