import { afterAll, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { applyPackageRecipe, extractPackageArchive } from "../papercrane/engineArchives";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-links-"));
const oldDir = process.env.PAPERBOARD_DIR;
process.env.PAPERBOARD_DIR = path.join(root, "state");
afterAll(() => {
    if (oldDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = oldDir;
    fs.rmSync(root, { recursive: true, force: true });
});
let sequence = 0;
// Headers make it possible to test members node-tar's writer refuses to emit.
function archive(entries: { name: string; type?: string; link?: string; content?: string }[]): string {
    const blocks: Buffer[] = [];
    for (const entry of entries) {
        const content = Buffer.from(entry.content ?? "");
        if (Buffer.byteLength(entry.name) > 100) blocks.push(new tar.Pax({ path: entry.name }).encode());
        const header = new tar.Header({ path: entry.name, type: (entry.type ?? "File") as tar.Header["type"], linkpath: entry.link ?? "", mode: 0o755, size: content.length });
        header.encode();
        blocks.push(Buffer.from(header.block!));
        if (content.length) {
            const data = Buffer.alloc(Math.ceil(content.length / 512) * 512);
            content.copy(data);
            blocks.push(data);
        }
    }
    blocks.push(Buffer.alloc(1024));
    const file = path.join(root, `${++sequence}.tar`);
    fs.writeFileSync(file, Buffer.concat(blocks));
    return file;
}
async function install(entries: Parameters<typeof archive>[0], source = "runtime") {
    const file = archive(entries);
    const dest = path.join(root, `out-${sequence}`);
    await applyPackageRecipe(file, dest, { unpack: "tar", take: { bin: source } });
    return dest;
}
const tool = { name: "runtime/tool", content: "tool" };
const link = (name: string, target: string) => ({ name: `runtime/${name}`, type: "SymbolicLink", link: target });
it("installs a symlink chain with exact targets", async () => {
    const dest = await install([tool, link("first", "tool"), link("second", "first")]);
    expect(fs.readlinkSync(path.join(dest, "bin/second"))).toBe("first");
    expect(fs.readFileSync(path.join(dest, "bin/second"), "utf8")).toBe("tool");
});
it("installs forward links and resolves directory links in targets", async () => {
    const dest = await install([link("second", "dir/tool"), link("dir", "real"), { name: "runtime/real/tool", content: "later" }]);
    expect(fs.readFileSync(path.join(dest, "bin/second"), "utf8")).toBe("later");
});
it("refuses an escaping chain, resolving directory links before dot-dot", async () => {
    await expect(install([tool, link("deep/dir", "../.."), link("deep/bad", "dir/../outside")])).rejects.toThrow(/deep\/bad/);
});
it("refuses loops", async () => {
    await expect(install([tool, link("first", "second"), link("second", "first")])).rejects.toThrow(/loop.*first|loop.*second/);
});
it("refuses writing through a symlink directory even when declared later", async () => {
    await expect(install([{ name: "runtime/dir/file", content: "bad" }, link("dir", "real")])).rejects.toThrow(/dir\/file.*through/);
});
it("fails loudly for a member node-tar would skip for excessive depth", async () => {
    const name = `runtime/${"d/".repeat(1100)}file`;
    await expect(install([{ name, content: "bad" }])).rejects.toThrow(/file.*path excessively deep/);
});
it("refuses special files and absolute link targets", async () => {
    await expect(install([{ name: "runtime/pipe", type: "FIFO" }])).rejects.toThrow(/pipe/);
    await expect(install([tool, link("absolute", "/runtime/tool")])).rejects.toThrow(/absolute/);
});
it("refuses links that escape after a recipe take", async () => {
    await expect(install([
        { name: "runtime/sub/tool", content: "tool" },
        { name: "outside", content: "outside take" },
        { name: "runtime/sub/bad", type: "SymbolicLink", link: "../../outside" },
    ], "runtime/sub")).rejects.toThrow(/bad/);
});
it("installs forward hardlinks after stripping a wrapper", async () => {
    const file = archive([{ name: "wrapper/bin/alias", type: "Link", link: "wrapper/bin/tool" }, { name: "wrapper/bin/tool", content: "hardlinked" }]);
    const dest = path.join(root, `out-${sequence}`);
    await extractPackageArchive(file, dest, "wrapped", ".tar");
    expect(fs.statSync(path.join(dest, "bin/alias")).ino).toBe(fs.statSync(path.join(dest, "bin/tool")).ino);
});

it("allows a fully contained target even when lexical normalization would escape", async () => {
    const dest = await install([
        tool, { name: "runtime/deep/a/keep", content: "directory" },
        link("child", "deep/a"), link("safe", "child/../../tool"),
    ]);
    expect(fs.readFileSync(path.join(dest, "bin/safe"), "utf8")).toBe("tool");
});
it("refuses a hardlink outside the package tree", async () => {
    await expect(install([{ name: "runtime/bad-hardlink", type: "Link", link: "../outside" }])).rejects.toThrow(/bad-hardlink/);
});

it("refuses link chains longer than the resolution bound", async () => {
    const chain = Array.from({ length: 42 }, (_, i) => link(`link${i}`, i === 41 ? "tool" : `link${i + 1}`));
    await expect(install([tool, ...chain])).rejects.toThrow(/depth exceeded.*link0/);
});
it("refuses a link whose target traverses an existing destination alias", async () => {
    const file = archive([link("bad", "alias/tool")]);
    const dest = path.join(root, `existing-${sequence}`);
    fs.mkdirSync(path.join(dest, "runtime"), { recursive: true });
    fs.symlinkSync(root, path.join(dest, "runtime/alias"));
    await expect(extractPackageArchive(file, dest, "root", ".tar")).rejects.toThrow(/bad.*existing symlink/);
});
