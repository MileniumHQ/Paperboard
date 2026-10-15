// Local AI's project tools at their boundary: every path is confined to the
// project folder on a real filesystem, every read is capped, and an edit
// replaces exactly the text it names.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    MAX_FILE_BYTES,
    MAX_LIST_ENTRIES,
    MAX_READ_CHARS,
    MAX_SEARCH_RESULTS,
    ProjectFiles,
    ProjectScopeError,
} from "../src/service/projectFiles";
import { globMatcher, isLocalMode, localMode, projectToolArguments, projectToolAsks, replaceExact } from "../src/core/projectTools";

let base: string;
let root: string;
let outside: string;
let files: ProjectFiles;

beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-project-"));
    root = path.join(base, "project");
    outside = path.join(base, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    files = await ProjectFiles.open(root);
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

const write = (rel: string, text: string) => files.prepareChange("write_file", { path: rel, content: text }).then((c) => c.apply());
const edit = (rel: string, oldText: string, newText: string, replaceAll = false) =>
    files.prepareChange("edit_file", { path: rel, old_text: oldText, new_text: newText, ...(replaceAll ? { replace_all: true } : {}) }).then((c) => c.apply());

describe("scoping", () => {
    it("refuses .. and absolute paths, for reading and writing", async () => {
        for (const bad of ["../outside/secret.txt", "a/../../outside/secret.txt", path.join(outside, "secret.txt"), "/etc/passwd"]) {
            await expect(files.readFile(bad)).rejects.toBeInstanceOf(ProjectScopeError);
            await expect(files.prepareChange("write_file", { path: bad, content: "x" })).rejects.toBeInstanceOf(ProjectScopeError);
        }
        await expect(files.listDirectory("..")).rejects.toBeInstanceOf(ProjectScopeError);
        await expect(files.search("..", { text: "secret" })).rejects.toBeInstanceOf(ProjectScopeError);
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("top secret");
    });

    it("refuses symlinks that lead outside: to a file, to a folder, and dangling", async () => {
        fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "file-link"));
        fs.symlinkSync(outside, path.join(root, "dir-link"));
        fs.symlinkSync(path.join(outside, "new.txt"), path.join(root, "dangling"));
        await expect(files.readFile("file-link")).rejects.toThrow("leads outside the project");
        await expect(files.readFile("dir-link/secret.txt")).rejects.toThrow("leads outside the project");
        await expect(files.listDirectory("dir-link")).rejects.toThrow("leads outside the project");
        await expect(write("file-link", "pwned")).rejects.toBeInstanceOf(ProjectScopeError);
        await expect(write("dir-link/new.txt", "pwned")).rejects.toBeInstanceOf(ProjectScopeError);
        await expect(write("dangling", "pwned")).rejects.toBeInstanceOf(ProjectScopeError);
        await expect(edit("file-link", "top", "no")).rejects.toBeInstanceOf(ProjectScopeError);
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("top secret");
        expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
        // the search never follows a link
        expect(await files.search(".", { text: "secret" })).toBe("No matches.");
    });

    it("follows a symlink that stays inside the project", async () => {
        fs.writeFileSync(path.join(root, "real.txt"), "inside");
        fs.symlinkSync(path.join(root, "real.txt"), path.join(root, "alias"));
        expect(await files.readFile("alias")).toContain("inside");
    });

    it("a link swapped in after the card was shown is replaced, not written through", async () => {
        fs.writeFileSync(path.join(root, "a.txt"), "one");
        const change = await files.prepareChange("write_file", { path: "a.txt", content: "two" });
        fs.rmSync(path.join(root, "a.txt"));
        fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "a.txt"));
        await expect(change.apply()).rejects.toBeInstanceOf(ProjectScopeError);
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("top secret");
    });

    it("creates parent folders inside the project", async () => {
        expect(await write("src/deep/new.ts", "export {};\n")).toBe("Created src/deep/new.ts (11 bytes).");
        expect(fs.readFileSync(path.join(root, "src", "deep", "new.ts"), "utf8")).toBe("export {};\n");
    });
});

describe("caps", () => {
    it("reads a long file in parts, with where to read on", async () => {
        const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
        fs.writeFileSync(path.join(root, "long.txt"), lines.join("\n"));
        const first = await files.readFile("long.txt");
        expect(first.length).toBeLessThan(MAX_READ_CHARS + 200);
        const next = Number(/start_line (\d+)/.exec(first)![1]);
        expect(first).toContain(`line ${next - 1}\n`);
        expect(first).not.toContain(`line ${next}\n`);
        const second = await files.readFile("long.txt", next);
        expect(second.split("\n")[1]).toBe(`line ${next}`);
    });

    it("refuses a file over the size cap, and a binary file", async () => {
        fs.writeFileSync(path.join(root, "big.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 97));
        fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([1, 0, 2]));
        await expect(files.readFile("big.txt")).rejects.toThrow(`files over ${MAX_FILE_BYTES} bytes are not read`);
        await expect(files.readFile("bin.dat")).rejects.toThrow("binary");
        await expect(edit("big.txt", "a", "b")).rejects.toThrow("are not read");
    });

    it("lists at most MAX_LIST_ENTRIES entries and says more exist", async () => {
        for (let i = 0; i < MAX_LIST_ENTRIES + 5; i++) fs.writeFileSync(path.join(root, `f${i}`), "");
        fs.mkdirSync(path.join(root, "zdir"));
        const listing = (await files.listDirectory(".")).split("\n");
        expect(listing[0]).toBe(`.: ${MAX_LIST_ENTRIES} entries`);
        expect(listing.length).toBe(MAX_LIST_ENTRIES + 2);
        expect(listing.at(-1)).toBe("[6 more not listed]");
    });

    it("stops a search at MAX_SEARCH_RESULTS and says so", async () => {
        fs.writeFileSync(path.join(root, "many.txt"), Array.from({ length: MAX_SEARCH_RESULTS + 50 }, () => "needle").join("\n"));
        const out = (await files.search(".", { text: "NEEDLE" })).split("\n");
        expect(out[0]).toBe(`${MAX_SEARCH_RESULTS} matches:`);
        expect(out.at(-1)).toBe(`[stopped at ${MAX_SEARCH_RESULTS} results]`);
    });

    it("finds files by pattern, skipping .git and node_modules", async () => {
        fs.mkdirSync(path.join(root, "src", "ui"), { recursive: true });
        fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
        fs.mkdirSync(path.join(root, ".git"));
        for (const f of ["src/a.ts", "src/ui/b.ts", "src/c.css", "node_modules/x/d.ts", ".git/e.ts"]) fs.writeFileSync(path.join(root, f), "x");
        expect(await files.search(".", { pattern: "*.ts" })).toBe("2 matches:\nsrc/a.ts\nsrc/ui/b.ts");
        expect(await files.search(".", { pattern: "src/*.ts" })).toBe("1 match:\nsrc/a.ts");
        expect(await files.search("src", { pattern: "src/**/*.ts" })).toBe("2 matches:\nsrc/a.ts\nsrc/ui/b.ts");
    });
});

describe("edits", () => {
    it("replaces exactly the named text, with no pattern or $ handling", async () => {
        fs.writeFileSync(path.join(root, "a.js"), "const a = 1;\nconst b = a.*;\n");
        expect(await edit("a.js", "a.*", "$& + $1")).toBe("Edited a.js: replaced 1 occurrence.");
        expect(fs.readFileSync(path.join(root, "a.js"), "utf8")).toBe("const a = 1;\nconst b = $& + $1;\n");
    });

    it("refuses text that is missing or ambiguous, unless replace_all", async () => {
        fs.writeFileSync(path.join(root, "a.txt"), "x x x");
        await expect(edit("a.txt", "y", "z")).rejects.toThrow("was not found");
        await expect(edit("a.txt", "x", "z")).rejects.toThrow("appears 3 times");
        expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("x x x");
        expect(await edit("a.txt", "x", "z", true)).toBe("Edited a.txt: replaced 3 occurrences.");
        expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("z z z");
    });

    it("shows the diff before writing, and refuses when the file changed in between", async () => {
        fs.writeFileSync(path.join(root, "a.txt"), "hello world");
        const change = await files.prepareChange("edit_file", { path: "a.txt", old_text: "world", new_text: "there" });
        expect(change.details).toEqual({ kind: "edit", locations: ["a.txt"], diffs: [{ path: "a.txt", oldText: "hello world", newText: "hello there" }] });
        expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("hello world");
        fs.writeFileSync(path.join(root, "a.txt"), "hello world!");
        await expect(change.apply()).rejects.toThrow("changed after the change was shown");
        expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("hello world!");
    });
});

describe("tool shapes", () => {
    it("ask decides file changes by mode; reads never ask", () => {
        expect(projectToolAsks("write_file", "ask")).toBe(true);
        expect(projectToolAsks("edit_file", undefined)).toBe(true);
        expect(projectToolAsks("write_file", "accept-edits")).toBe(false);
        expect(projectToolAsks("edit_file", "accept-edits")).toBe(false);
        expect(projectToolAsks("read_file", "ask")).toBe(false);
        // an agent's mode id left on a chat is not Local AI's: it asks
        expect(localMode("bypassPermissions")).toBe("ask");
        expect(isLocalMode("accept-edits")).toBe(true);
        expect(isLocalMode("yolo")).toBe(false);
    });

    it("checks arguments", () => {
        expect(projectToolArguments("list_directory", {})).toEqual({ path: "." });
        expect(projectToolArguments("read_file", '{"path":"a","start_line":"3"}')).toEqual({ path: "a", start_line: 3 });
        expect(() => projectToolArguments("read_file", { path: "a\0b" })).toThrow("NUL");
        expect(() => projectToolArguments("search_files", {})).toThrow('give a "pattern"');
        expect(() => projectToolArguments("edit_file", { path: "a", old_text: "", new_text: "b" })).toThrow("can't be empty");
    });

    it("matches globs per folder", () => {
        expect(globMatcher("*.ts")("a/b/c.ts")).toBe(true);
        expect(globMatcher("a/*.ts")("a/b/c.ts")).toBe(false);
        expect(globMatcher("a/**/*.ts")("a/c.ts")).toBe(true);
        expect(globMatcher("a.?s")("axts")).toBe(false);
        expect(replaceExact("aXa", "a", "b", true)).toEqual({ text: "bXb", count: 2 });
    });
});
