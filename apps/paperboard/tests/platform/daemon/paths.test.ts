import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { TEST_TIMEOUT_MS } from "../../daemon/support/wait";
import * as fs from "node:fs";
import * as path from "node:path";
import { PaperCraneEngine } from "../../../papercrane/engine";
import { dataDir, listTree, tempDir } from "../../daemon/support/fs";
import { startDaemon, type InProcessDaemon } from "../../daemon/support/inproc";
import type { Rpc } from "../../daemon/support/rpc";

setDefaultTimeout(TEST_TIMEOUT_MS);

let daemon: InProcessDaemon;
let panel: Rpc;
let outside: string;

beforeAll(async () => {
	daemon = await startDaemon();
	panel = await daemon.panelRpc("test.paths");
	outside = tempDir("pb-outside-");
	fs.writeFileSync(path.join(outside, "secret.txt"), "outside bytes");
});
afterAll(async () => {
	await panel.close();
	await daemon.stop();
});

const panelRoot = () => path.join(daemon.dataDir, "files", "test.paths");

// Panel file, config and workspace paths stay inside the panel.
describe("panel file, config and workspace paths stay inside the panel", () => {
	test("paths resolve under files/<panel>/, and an empty path is the panel root only for getPath and exists", async () => {
		const written = (await panel.ok("file:write", { targetPath: path.join("a", "b.txt"), content: "x" })).path;
		expect(written).toBe(path.join(panelRoot(), "a", "b.txt"));
		expect((await panel.ok("file:getPath", { targetPath: "" })).path).toBe(panelRoot());
		expect((await panel.ok("file:exists", { targetPath: "" })).exists).toBe(true);
		for (const action of ["file:read", "file:write", "file:delete"]) {
			expect((await panel.fail(action, { targetPath: "", content: "x" })).code).toBe("INVALID_PARAMS");
		}
	});

	test("traversal and sibling-prefix escapes are refused and nothing outside changes", async () => {
		const sibling = path.join(daemon.dataDir, "files", "test.paths-evil");
		const before = listTree(daemon.dataDir);
		for (const target of [path.join("..", "..", "local", "crane.json"), path.join("..", "test.paths-evil", "x.txt"), path.join("..", "srv-evil")]) {
			expect((await panel.call("file:write", { targetPath: target, content: "pwned" })).error).toBeTruthy();
			expect((await panel.call("file:read", { targetPath: target })).error).toBeTruthy();
		}
		expect(fs.existsSync(sibling)).toBe(false);
		expect(listTree(daemon.dataDir)).toEqual(before);
	});

	test("config ids and workspace paths that climb, are absolute or are not .json are refused", async () => {
		for (const params of [
			{ id: "shell-../../x", data: {} },
			{ id: "test.paths", path: path.join("..", "x.json"), data: {} },
			{ id: "test.paths", path: path.resolve(outside, "x.json"), data: {} },
			{ id: "test.paths", path: "tabs.txt", data: {} },
		]) {
			expect((await panel.fail("config:set", params)).code).toBe("INVALID_PARAMS");
		}
		expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
	});

	if (process.platform !== "win32") {
		test("symlinked components are refused, including a symlinked folder that points outside", async () => {
			fs.mkdirSync(panelRoot(), { recursive: true });
			fs.symlinkSync(outside, path.join(panelRoot(), "escape"));
			fs.symlinkSync(path.join(outside, "secret.txt"), path.join(panelRoot(), "link.txt"));
			expect((await panel.call("file:read", { targetPath: "escape/secret.txt" })).error).toContain("symbolic link");
			expect((await panel.call("file:write", { targetPath: "escape/new.txt", content: "x" })).error).toContain("symbolic link");
			expect((await panel.call("file:read", { targetPath: "link.txt" })).error).toContain("symbolic link");
			expect((await panel.call("file:write", { targetPath: "link.txt", content: "pwned" })).error).toBeTruthy();
			expect((await panel.call("config:set", { id: "test.paths", path: "escape/w.json", data: {} })).error).toBeTruthy();
			expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
			expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("outside bytes");
		});
	}

	if (process.platform === "darwin" || process.platform === "win32") {
		test("a data directory spelled in another case still resolves on a case-insensitive filesystem", async () => {
			const dir = dataDir();
			const respelled = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
			const engine = new PaperCraneEngine(respelled);
			const written = await engine.writeFile("note.txt", "case", "test.case");
			expect(fs.readFileSync(path.join(dir, "files", "test.case", "note.txt"), "utf8")).toBe("case");
			expect(await engine.readFile("note.txt", "test.case")).toBe("case");
			expect(written.toLowerCase()).toBe(path.join(dir, "files", "test.case", "note.txt").toLowerCase());
		});
	}
});
