// Manifest honesty: the panel is unfinished until it has run on real
// hardware (0.x), and every remote host it reaches is declared.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import manifest from "../manifest.json";

describe("manifest", () => {
    it("is versioned 0.x", () => {
        expect(manifest.version).toMatch(/^0\.\d+\.\d+$/);
    });

    it("declares the Ollama registry and the web search host", () => {
        expect(manifest.network.hosts).toEqual(["registry.ollama.ai", "html.duckduckgo.com"]);
    });

    it("the service and UI reach no undeclared remote host (absence check)", () => {
        const root = path.join(import.meta.dir, "..", "src");
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
            }
        };
        walk(root);
        for (const file of files) {
            const urls = fs.readFileSync(file, "utf8").match(/https?:\/\/[^\s"'`)]+/g) ?? [];
            for (const url of urls) {
                if (/^http:\/\/127\.0\.0\.1/.test(url)) continue;
                expect(manifest.network.hosts).toContain(new URL(url).hostname);
            }
        }
    });
});
