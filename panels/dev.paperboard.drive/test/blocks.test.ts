// Drive's blocks, run the way the Blocks panel runs them: through PaperAPI's
// registry in memory, which checks what they register, take and give back
// as the daemon's does, over a real drive on disk.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { memoryBlocks } from "@mileniumhq/paperapi";
import { driveBlocks } from "../src/blocks";
import { PANEL_ID } from "../src/lib/contract";
import { openDrive } from "./helpers/drive";

async function blocks() {
    const t = await openDrive();
    const changes: string[][] = [];
    const registry = memoryBlocks(PANEL_ID);
    await registry.panel.register(driveBlocks(t.drive, (folders) => changes.push(folders)));
    return { ...t, registry, changes };
}

describe("Drive's blocks", () => {
    test("registers its values and commands, and nothing of the page's", async () => {
        const { registry } = await blocks();
        expect(
            registry
                .list()
                .map((b) => b.entry)
                .sort(),
        ).toEqual([
            "command.create-folder",
            "command.delete",
            "command.move",
            "command.rename",
            "command.write-text-file",
            "type.item",
            "value.files-in-folder",
            "value.text-of-file",
        ]);
    });

    test("a flow makes a folder, writes a file into it, reads it, and lists it", async () => {
        const { registry, root, changes } = await blocks();
        expect(await registry.run("create-folder", { name: "Notes" })).toBe("Notes");
        expect(await registry.run("write-text-file", { file: "Notes/today.md", text: "# Today" })).toBe("Notes/today.md");
        expect(await registry.read("text-of-file", { file: "Notes/today.md" })).toBe("# Today");
        expect(fs.readFileSync(path.join(root, "Notes/today.md"), "utf8")).toBe("# Today");
        expect(await registry.read("files-in-folder", { folder: "Notes" })).toEqual(["Notes/today.md"]);
        expect(await registry.read("files-in-folder", {})).toEqual(["Notes"]);
        expect(await registry.property("item", "name", "Notes/today.md")).toBe("today.md");
        expect(await registry.property("item", "folder", "Notes")).toBe(true);
        expect(await registry.property("item", "size", "Notes/today.md")).toBe(7);
        expect(await registry.property("item", "parent", "Notes/today.md")).toBe("Notes");
        // each change names the folders it touched, so open windows list them again
        expect(changes).toEqual([[""], ["Notes", ""]]);
    });

    test("a flow renames, moves and deletes", async () => {
        const { registry, root, put, changes } = await blocks();
        put("draft.md", "draft");
        await registry.run("create-folder", { name: "Archive" });
        expect(await registry.run("rename", { item: "draft.md", name: "final.md" })).toBe("final.md");
        expect(await registry.run("move", { item: "final.md", folder: "Archive" })).toBe("Archive/final.md");
        expect(await registry.read("files-in-folder", { folder: "Archive" })).toEqual(["Archive/final.md"]);
        await registry.run("delete", { item: "Archive" });
        expect(fs.readdirSync(root)).toEqual([]);
        expect(changes.at(-2)).toEqual(["Archive", ""]);
        expect(changes.at(-1)).toEqual([""]);
    });

    test("a flow can't reach outside the drive, and says why", async () => {
        const { registry, outside } = await blocks();
        fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
        await expect(registry.read("text-of-file", { file: "../outside/secret.txt" })).rejects.toThrow("isn't a path in the drive");
        await expect(registry.run("write-text-file", { file: "../outside/secret.txt", text: "x" })).rejects.toThrow("isn't a path in the drive");
        await expect(registry.run("delete", { item: "../outside" })).rejects.toThrow("isn't a path in the drive");
        await expect(registry.run("create-folder", { name: "../x" })).rejects.toThrow("can't have “/”");
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
    });
});
