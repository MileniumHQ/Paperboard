import { test, expect } from "bun:test";
import { panelsApi } from "../src/panels";

test("registry merge preserves installed provenance and version without inventing publisher facts", async () => {
    const list = panelsApi.list;
    const fetch = globalThis.fetch;
    try {
        panelsApi.list = async () => [{ id: "panel.a", name: "A", version: "0.1.0", installSource: "dev", isLinked: true }];
        globalThis.fetch = async () => Response.json({ "panel.a": { name: "A", version: "0.2.0" } });
        const [panel] = await panelsApi.registry("local");
        // an installed panel shows what is installed; the registry's newer
        // release is reported separately, never as the installed version
        expect(panel).toMatchObject({ installSource: "dev", isLinked: true, installedVersion: "0.1.0", version: "0.1.0", latestVersion: "0.2.0", isInstalled: true });
        expect(panel.publisher).toBeUndefined();
        globalThis.fetch = async () => new Response("unavailable", { status: 503 });
        await expect(panelsApi.registry("local")).rejects.toThrow(/503/);
    } finally { panelsApi.list = list; globalThis.fetch = fetch; }
});

test("installed panels describe themselves from their local manifest", async () => {
    const list = panelsApi.list;
    const fetch = globalThis.fetch;
    try {
        panelsApi.list = async () => [{ id: "panel.a", name: "Local A", description: "local words", version: "3.0.0-alpha", publisher: "Paperboard" }];
        globalThis.fetch = async () => Response.json({
            "panel.a": { name: "Registry A", description: "registry words", version: "1.1.0", publisher: "Someone" },
            "panel.b": { name: "B", description: "not installed", version: "2.0.0", publisher: "Pub" },
        });
        const panels = await panelsApi.registry("local");
        const a = panels.find((p) => p.id === "panel.a")!;
        const b = panels.find((p) => p.id === "panel.b")!;
        expect(a).toMatchObject({ name: "Local A", description: "local words", version: "3.0.0-alpha", latestVersion: "1.1.0", publisher: "Paperboard" });
        expect(b).toMatchObject({ name: "B", description: "not installed", version: "2.0.0", latestVersion: "2.0.0", publisher: "Pub", isInstalled: false });
    } finally { panelsApi.list = list; globalThis.fetch = fetch; }
});
