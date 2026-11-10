import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { TEST_TIMEOUT_MS } from "../../daemon/support/wait";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractTarSafely } from "../../../papercrane/storage";
import { applyPackageRecipe, extractArchive, extractPackageArchive } from "../../../papercrane/engineArchives";
import { tar, tarGz, zip, type TarMember } from "../../daemon/support/archive";
import { listTree, tempDir } from "../../daemon/support/fs";

setDefaultTimeout(TEST_TIMEOUT_MS);

// A destination inside a parent we watch: nothing may appear beside it.
function sandbox() {
	const parent = tempDir("pb-extract-");
	const dest = path.join(parent, "dest");
	fs.mkdirSync(dest);
	return { parent, dest };
}

function archiveFile(name: string, bytes: Buffer): string {
	const file = path.join(tempDir("pb-archive-"), name);
	fs.writeFileSync(file, bytes);
	return file;
}

const hostile: Record<string, TarMember[]> = {
	"a ../ member": [{ name: "../evil.txt", content: "x" }],
	"an absolute member": [{ name: "/tmp/pb-evil.txt", content: "x" }],
	"a symlink that escapes": [{ name: "out", type: "symlink", target: "../../outside" }],
	"an absolute link target": [{ name: "passwd", type: "symlink", target: "/etc/passwd" }],
	"a directory link resolved before ..": [
		{ name: "s", type: "symlink", target: "." },
		{ name: "t", type: "symlink", target: "s/.." },
	],
	"a link loop": [
		{ name: "a", type: "symlink", target: "b" },
		{ name: "b", type: "symlink", target: "a" },
		{ name: "c", type: "symlink", target: "a/x" },
	],
	"a write through a symlinked directory": [
		{ name: "sub/", type: "dir" },
		{ name: "l", type: "symlink", target: "sub" },
		{ name: "l/f.txt", content: "x" },
	],
	"a hardlink outside the tree": [{ name: "h", type: "hardlink", target: "../../etc/passwd" }],
	"a fifo": [{ name: "pipe", type: "fifo" }],
	"a character device": [{ name: "dev", type: "chardev" }],
	"a member too deep for node-tar": [{ name: `${Array.from({ length: 1100 }, () => "d").join("/")}/f.txt`, content: "x" }],
};

// Archives can't write outside their destination.
describe("archives cannot write outside their destination", () => {
	for (const [kind, members] of Object.entries(hostile)) {
		test(`${kind} refuses the whole archive and writes nothing`, async () => {
			const { parent, dest } = sandbox();
			const file = archiveFile("hostile.tar", tar([{ name: "first.txt", content: "ok" }, ...members]));
			await expect(extractTarSafely(file, dest)).rejects.toThrow();
			expect(fs.readdirSync(parent)).toEqual(["dest"]);
			expect(listTree(dest)).toEqual([]);
		});
	}

	test("a link that only escapes after strip is refused, and escape never retries as a flat extraction", async () => {
		const { parent, dest } = sandbox();
		const file = archiveFile("wrapped.tar.gz", tarGz([
			{ name: "wrap/bin/tool", content: "#!/bin/sh\n" },
			{ name: "wrap/link", type: "symlink", target: "../outside" },
		]));
		await expect(extractTarSafely(file, dest, 1)).rejects.toThrow("escapes");
		await expect(extractPackageArchive(file, dest, "wrapped", ".tar.gz")).rejects.toThrow();
		expect(fs.readdirSync(parent)).toEqual(["dest"]);
		expect(listTree(dest).filter((f) => !f.startsWith("bin"))).toEqual([]);
		expect(fs.existsSync(path.join(dest, "wrap"))).toBe(false);
	});

	test("zip members with ../ or absolute names are refused", async () => {
		for (const name of ["../evil.txt", "/abs/evil.txt"]) {
			const { parent, dest } = sandbox();
			// zip writers clean names, so the hostile name is written over a
			// placeholder of the same length in the finished bytes
			const placeholder = "q".repeat(name.length);
			const bytes = zip([{ name: placeholder, content: "x" }]);
			const file = archiveFile("hostile.zip", Buffer.from(bytes.toString("latin1").replaceAll(placeholder, name), "latin1"));
			await expect(extractArchive(file, dest)).rejects.toThrow("escapes");
			expect(fs.readdirSync(parent)).toEqual(["dest"]);
		}
	});

	if (process.platform !== "win32") {
		test("valid in-tree symlink chains and hardlinks install exactly", async () => {
			const { parent, dest } = sandbox();
			const file = archiveFile("good.tar", tar([
				{ name: "lib/", type: "dir" },
				{ name: "lib/impl", content: "real bytes", mode: 0o755 },
				{ name: "lib/real", type: "symlink", target: "impl" },
				{ name: "bin/", type: "dir" },
				{ name: "bin/tool", type: "symlink", target: "../lib/real" },
				{ name: "bin/copy", type: "hardlink", target: "lib/impl" },
			]));
			await extractTarSafely(file, dest);
			expect(fs.readlinkSync(path.join(dest, "bin", "tool"))).toBe("../lib/real");
			expect(fs.readFileSync(path.join(dest, "bin", "tool"), "utf8")).toBe("real bytes");
			expect(fs.statSync(path.join(dest, "bin", "copy")).ino).toBe(fs.statSync(path.join(dest, "lib", "impl")).ino);
			expect(fs.readdirSync(parent)).toEqual(["dest"]);
		});

		test("a recipe take that moves a link out of reach is refused", async () => {
			const { parent, dest } = sandbox();
			const file = archiveFile("recipe.tar", tar([
				{ name: "pkg/sub/data", content: "x" },
				{ name: "pkg/sub/tool", type: "symlink", target: "../../pkg/sub/data" },
			]));
			await expect(applyPackageRecipe(file, dest, { unpack: "tar", take: { "bin/tool": "pkg/sub/tool" } })).rejects.toThrow();
			expect(fs.readdirSync(parent)).toEqual(["dest"]);
		});
	}
});
