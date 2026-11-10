// Throwaway folders under the OS temp dir, removed after each test file.
import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const made: string[] = [];
afterAll(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh empty folder; gone once the file's tests finish. */
export function tempDir(prefix = "gameserver-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    return dir;
}

/** Writes each `relative path -> content` under root, making folders. */
export function writeTree(root: string, files: Record<string, string | Uint8Array>): void {
    for (const [rel, content] of Object.entries(files)) {
        const file = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}

/** Every file under root as `relative/posix/path -> utf8 content`, folders as `path/`. */
export function readTree(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                out[`${rel}/`] = "";
                walk(full, rel);
            } else out[rel] = fs.readFileSync(full, "utf8");
        }
    };
    walk(root, "");
    return out;
}
