// Checkpoints of the home folder, kept and restored on the real file system.

import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Checkpoints, KEPT } from "../src/service/checkpoints";
import { HomeFolder } from "../src/service/homeFolder";

const cleanups: (() => unknown)[] = [];
afterEach(() => {
    for (const c of cleanups.splice(0).reverse()) c();
});

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-checkpoints-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const home = new HomeFolder(path.join(root, "home"));
    home.ensure();
    const dir = path.join(root, "checkpoints");
    const tools = new Checkpoints({ home, dir }).toolset();
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await tools.call(name, args);
        if (r.isError) throw new Error(r.text);
        return r.text;
    };
    const file = (rel: string) => path.join(home.root, rel);
    const put = (rel: string, data: string) => {
        fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
        fs.writeFileSync(file(rel), data);
    };
    const read = (rel: string) => fs.readFileSync(file(rel), "utf8");
    const blobs = () => fs.readdirSync(path.join(dir, "files"), { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
    return { root, home, dir, tools, call, file, put, read, blobs };
}

describe("checkpoints", () => {
    test("a checkpoint keeps each file's contents once, and says what changed", async () => {
        const t = setup();
        t.put("notes.md", "same");
        t.put("copy.md", "same");
        expect(await t.call("checkpoint", { note: "first" })).toContain('checkpoint 1 ("first")');
        expect(t.blobs()).toBe(1);

        expect(await t.call("checkpoint", { note: "again" })).toContain("Nothing has changed since checkpoint 1");
        t.put("notes.md", "edited");
        t.put("new.md", "new");
        fs.rmSync(t.file("copy.md"));
        const second = await t.call("checkpoint", { note: "second" });
        expect(second).toContain("1 changed (~/notes.md)");
        expect(second).toContain("1 new (~/new.md)");
        expect(second).toContain("1 removed (~/copy.md)");

        const list = await t.call("checkpoints");
        expect(list.indexOf("2 · ")).toBeLessThan(list.indexOf("1 · "));
        expect(list).toContain("Nothing has changed since checkpoint 2");
        t.put("notes.md", "edited again");
        expect(await t.call("checkpoints", { checkpoint: 1 })).toContain("1 changed (~/notes.md)");
    });

    test("restore brings the folder back, and can itself be undone", async () => {
        const t = setup();
        t.put("Apps/planner/index.html", "<h1>v1</h1>");
        t.put("Apps/planner/package.json", '{"dependencies":{}}');
        await t.call("checkpoint", { note: "planner works" });

        t.put("Apps/planner/index.html", "<h1>broken</h1>");
        t.put("Apps/planner/package.json", '{"dependencies":{"react":"^19"}}');
        t.put("Apps/planner/extra/thing.js", "x");
        fs.rmSync(t.file("Downloads"), { recursive: true });

        const restored = await t.call("restore", { checkpoint: 1 });
        expect(restored).toContain('~ is back to checkpoint 1 ("planner works")');
        expect(restored).toContain("Checkpoint 2 has how it was before");
        expect(restored).toContain("add_package for planner");
        expect(t.read("Apps/planner/index.html")).toBe("<h1>v1</h1>");
        expect(fs.existsSync(t.file("Apps/planner/extra"))).toBe(false);
        expect(fs.existsSync(t.file("Downloads"))).toBe(true);

        expect(await t.call("restore", { checkpoint: 1 })).toContain("already matches checkpoint 1");
        await t.call("restore", { checkpoint: 2 });
        expect(t.read("Apps/planner/index.html")).toBe("<h1>broken</h1>");
        expect(t.read("Apps/planner/extra/thing.js")).toBe("x");
    });

    test("restore of one path leaves the rest alone", async () => {
        const t = setup();
        t.put("Apps/a/index.html", "a1");
        t.put("Apps/b/index.html", "b1");
        await t.call("checkpoint", { note: "both" });
        t.put("Apps/a/index.html", "a2");
        t.put("Apps/a/more.js", "more");
        t.put("Apps/b/index.html", "b2");

        expect(await t.call("restore", { checkpoint: 1, path: "~/Apps/a" })).toContain("~/Apps/a is back to checkpoint 1");
        expect(t.read("Apps/a/index.html")).toBe("a1");
        expect(fs.existsSync(t.file("Apps/a/more.js"))).toBe(false);
        expect(t.read("Apps/b/index.html")).toBe("b2");
        await expect(t.call("restore", { checkpoint: 1, path: "../outside" })).rejects.toThrow("home folder");
    });

    test("a file and a folder can trade places", async () => {
        const t = setup();
        t.put("thing", "a file");
        await t.call("checkpoint", { note: "file" });
        fs.rmSync(t.file("thing"));
        t.put("thing/inside.txt", "now a folder");
        await t.call("checkpoint", { note: "folder" });

        await t.call("restore", { checkpoint: 1 });
        expect(t.read("thing")).toBe("a file");
        await t.call("restore", { checkpoint: 2 });
        expect(t.read("thing/inside.txt")).toBe("now a folder");
    });

    test("links are never kept, followed or deleted, and packages are left out", async () => {
        const t = setup();
        const outside = path.join(t.root, "outside.txt");
        fs.writeFileSync(outside, "the host's");
        fs.symlinkSync(outside, t.file("link"));
        t.put("Apps/x/node_modules/react/index.js", "react");
        t.put("Apps/x/.node_modules-1234/half.js", "half");
        t.put("Apps/x/index.html", "x");

        const made = await t.call("checkpoint", { note: "with a link" });
        expect(made).toContain("~/link (a link)");
        expect(t.blobs()).toBe(1);

        t.put("Apps/x/index.html", "changed");
        await t.call("restore", { checkpoint: 1 });
        expect(fs.lstatSync(t.file("link")).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(outside, "utf8")).toBe("the host's");
        expect(t.read("Apps/x/node_modules/react/index.js")).toBe("react");

        // a link where a checkpoint has a file isn't written through
        fs.rmSync(t.file("Apps/x/index.html"));
        fs.symlinkSync(outside, t.file("Apps/x/index.html"));
        await expect(t.call("restore", { checkpoint: 1 })).rejects.toThrow("only partly back to checkpoint 1 (\"with a link\"), and checkpoint 3 has how it was: only files in your home folder");
        expect(fs.readFileSync(outside, "utf8")).toBe("the host's");
    });

    test(`past ${KEPT}, the oldest go with the contents only they had`, async () => {
        const t = setup();
        t.put("keep.md", "kept throughout");
        for (let i = 0; i <= KEPT; i++) {
            t.put("n.md", `version ${i}`);
            await t.call("checkpoint", { note: `v${i}` });
        }
        const ids = fs.readdirSync(t.dir).filter((n) => n.endsWith(".json"));
        expect(ids).toHaveLength(KEPT);
        expect(ids).not.toContain("1.json");
        expect(t.blobs()).toBe(KEPT + 1);
        await expect(t.call("restore", { checkpoint: 1 })).rejects.toThrow("there's no checkpoint 1");
        await t.call("restore", { checkpoint: 2 });
        expect(t.read("n.md")).toBe("version 1");
    });

    test("erasing the home folder erases its checkpoints", async () => {
        const t = setup();
        t.put("a.md", "a");
        await t.call("checkpoint", { note: "a" });
        t.home.erase();
        expect(fs.existsSync(t.dir)).toBe(false);
        expect(await t.call("checkpoints")).toContain("no checkpoints yet");
    });

    test("bad input says what's wrong", async () => {
        const t = setup();
        await expect(t.call("checkpoint", { note: " " })).rejects.toThrow("give the checkpoint a note");
        await expect(t.call("restore", { checkpoint: "1" })).rejects.toThrow("by its number");
        await expect(t.call("restore", { checkpoint: 9 })).rejects.toThrow("there's no checkpoint 9");
    });
});
