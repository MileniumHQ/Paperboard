import { describe, expect, test } from "bun:test";
import { mergeRegistryWithInstalled } from "../src/panelMerge";

describe("registry panels merged with installed ones", () => {
    test("a release published without an icon gets no icon address, so the card shows its glyph", () => {
        const [withIcon, without] = mergeRegistryWithInstalled(
            {
                "dev.example.a": { name: "A", version: "1.0.0", iconUrl: "https://registry.test/panel/dev.example.a/icon" },
                "dev.example.b": { name: "B", version: "1.0.0" },
            },
            [],
            "https://registry.test/",
        );
        expect(withIcon.iconUrl).toBe("https://registry.test/panel/dev.example.a/icon");
        expect("iconUrl" in without).toBe(false);
        expect(without.downloadUrl).toBe("https://registry.test/panel/dev.example.b/download");
    });
});
