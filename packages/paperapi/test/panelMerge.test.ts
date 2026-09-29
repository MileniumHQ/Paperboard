// The ONE registry merge shared by the shell's registry() and the
// Origami-served panel library: these assert the pure contract, and the
// registry() tests in panelLibrary.test.ts assert the transport path.
import { test, expect } from "bun:test";
import { mergeRegistryWithInstalled } from "../src/panelMerge";

test("registry-only panels address their archive and icon relative to the library origin", () => {
    const panels = mergeRegistryWithInstalled(
        { "panel.a": { name: "A", version: "1.2.0", description: "words" } },
        [],
        "",
    );
    expect(panels).toEqual([
        {
            id: "panel.a",
            name: "A",
            description: "words",
            version: "1.2.0",
            latestVersion: "1.2.0",
            publisher: undefined,
            icon: undefined,
            iconUrl: "/panel/panel.a/icon",
            downloadUrl: "/panel/panel.a/download",
            size: "Unknown",
            updatedAt: "Recently",
            isInstalled: false,
            installedVersion: undefined,
            installSource: undefined,
            isLinked: undefined,
        },
    ]);
});

test("an installed panel describes itself; the registry adds only the newest release", () => {
    const [panel] = mergeRegistryWithInstalled(
        {
            "panel.a": {
                name: "Registry A",
                description: "registry words",
                version: "2.0.0",
                publisher: "Someone",
                manifest: { publisher: "Manifest Pub" },
            },
        },
        [
            {
                id: "panel.a",
                name: "Local A",
                description: "local words",
                version: "3.0.0-alpha",
                publisher: "Paperboard",
                installSource: "dev",
                isLinked: true,
            },
        ],
        "",
    );
    expect(panel).toMatchObject({
        name: "Local A",
        description: "local words",
        version: "3.0.0-alpha",
        latestVersion: "2.0.0",
        publisher: "Paperboard",
        isInstalled: true,
        installedVersion: "3.0.0-alpha",
        installSource: "dev",
        isLinked: true,
    });
    expect(panel.iconUrl).toBe("/panel/panel.a/icon");
});

test("installed panels missing from the registry are still listed", () => {
    const panels = mergeRegistryWithInstalled(
        { "panel.b": { name: "B", version: "1.0.0" } },
        [{ id: "panel.local", name: "Local only" }],
        "https://registry.example",
    );
    expect(panels.map((p) => p.id)).toEqual(["panel.b", "panel.local"]);
    expect(panels[0].downloadUrl).toBe(
        "https://registry.example/panel/panel.b/download",
    );
    expect(panels[1]).toMatchObject({ id: "panel.local", name: "Local only" });
});

test("record URLs win over generated ones and malformed records are skipped", () => {
    const panels = mergeRegistryWithInstalled(
        {
            "panel.a": {
                name: "A",
                iconUrl: "https://cdn.example/a.png",
                downloadUrl: "https://cdn.example/a.tar.gz",
            },
            "panel.b": null as any,
        },
        [],
        "https://registry.example/",
    );
    expect(panels).toHaveLength(1);
    expect(panels[0].iconUrl).toBe("https://cdn.example/a.png");
    expect(panels[0].downloadUrl).toBe("https://cdn.example/a.tar.gz");
});

test("the registry's listing and archive size reach the merged item; bad listings are filtered", () => {
    const [panel] = mergeRegistryWithInstalled(
        {
            "panel.a": {
                name: "A",
                sizeBytes: 2048,
                store: {
                    screenshots: [{ light: "javascript:x" }],
                    credits: [{ name: "Solid", detail: "Rendering" }],
                },
            },
        },
        [],
        "",
    );
    expect(panel!.archiveBytes).toBe(2048);
    expect(panel!.store).toEqual({
        screenshots: [],
        services: [],
        credits: [{ name: "Solid", detail: "Rendering" }],
        requirements: [],
    });
});

test("trailing slashes on the registry base are dropped, however many", () => {
    const panels = mergeRegistryWithInstalled(
        { "panel.a": { name: "A", version: "1.0.0", description: "" } },
        [],
        "https://registry.example///",
    );
    expect(panels[0]!.downloadUrl).toBe("https://registry.example/panel/panel.a/download");
    const long = "/".repeat(200_000) + "x" + "/".repeat(200_000);
    const t = Date.now();
    mergeRegistryWithInstalled({ "panel.a": { name: "A", version: "1.0.0", description: "" } }, [], long);
    expect(Date.now() - t).toBeLessThan(500);
});
