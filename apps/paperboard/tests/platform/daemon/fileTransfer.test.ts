import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { type DaemonEndpoint, type PanelFileTransferDeps, runPanelExport, runPanelImport } from "../../../src/main/panelFileTransfer";
import { runPanelFileTransfer } from "../../../src/renderer/src/lib/panelFileTransfer";
import { tempDir } from "../../daemon/support/fs";
import { type InProcessDaemon, startDaemon } from "../../daemon/support/inproc";
import { TEST_TIMEOUT_MS } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const PANEL = "test.transfer";
let daemon: InProcessDaemon;
let storage: string;
const previousCap = process.env.PAPERCRANE_DAV_MAX_UPLOAD;

beforeAll(async () => {
	// the daemon reads its upload cap per request
	process.env.PAPERCRANE_DAV_MAX_UPLOAD = String(64 * 1024);
	daemon = await startDaemon();
	storage = path.join(daemon.dataDir, "files", PANEL);
	fs.mkdirSync(storage, { recursive: true });
});
afterAll(async () => {
	await daemon.stop();
	if (previousCap === undefined) delete process.env.PAPERCRANE_DAV_MAX_UPLOAD;
	else process.env.PAPERCRANE_DAV_MAX_UPLOAD = previousCap;
});

const endpoint = (): DaemonEndpoint => ({ host: "127.0.0.1", port: daemon.instance.localPort, token: daemon.token });

function deps(answers: { save?: string | null; open?: string | null; paths?: string[] | null }, to: () => DaemonEndpoint = endpoint): PanelFileTransferDeps & { dialogs: string[] } {
	const dialogs: string[] = [];
	return {
		dialogs,
		pickSavePath: async () => {
			dialogs.push("save");
			return answers.save ?? null;
		},
		pickOpenPath: async () => {
			dialogs.push("open");
			return answers.open ?? null;
		},
		pickOpenPaths: async () => {
			dialogs.push("open-many");
			return answers.paths ?? null;
		},
		endpoint: to,
	};
}

const bytes = (n: number, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed) % 256));

// A loopback hop in front of the daemon that cuts every response after `limit` bytes.
async function cuttingProxy(limit: number): Promise<{ port: number; close(): Promise<void> }> {
	const server = net.createServer((client) => {
		const upstream = net.connect(daemon.instance.localPort, "127.0.0.1");
		let sent = 0;
		client.pipe(upstream);
		upstream.on("data", (chunk: Buffer) => {
			const room = limit - sent;
			if (room <= 0) return;
			client.write(chunk.subarray(0, room));
			sent += Math.min(room, chunk.length);
			if (sent >= limit) {
				upstream.destroy();
				client.destroy();
			}
		});
		upstream.on("end", () => client.end());
		upstream.on("error", (err) => client.destroy(err));
		client.on("error", () => upstream.destroy());
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as net.AddressInfo).port;
	return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// Panel file export and import never corrupt the chosen file.
describe("panel file export and import", () => {
	test("export copies the panel file exactly", async () => {
		const content = bytes(200_000, 7);
		fs.writeFileSync(path.join(storage, "world.dat"), content);
		const dest = path.join(tempDir(), "world.dat");
		const result = await runPanelExport({ computerId: "local", panelId: PANEL, path: "world.dat" }, deps({ save: dest }));
		expect(result).toEqual({ status: "exported", name: "world.dat", bytes: content.length });
		expect(fs.readFileSync(dest).equals(content)).toBe(true);
		expect(fs.readdirSync(path.dirname(dest))).toEqual(["world.dat"]);
	});

	test("a canceled export and a transfer cut off midway leave the chosen file as it was", async () => {
		fs.writeFileSync(path.join(storage, "big.dat"), bytes(300_000, 3));
		const dir = tempDir();
		const dest = path.join(dir, "keep.dat");
		fs.writeFileSync(dest, "the user's own file");

		expect(await runPanelExport({ computerId: "local", panelId: PANEL, path: "big.dat" }, deps({ save: null }))).toEqual({ status: "canceled" });
		expect(fs.readFileSync(dest, "utf8")).toBe("the user's own file");

		const proxy = await cuttingProxy(50_000);
		try {
			const cut = await runPanelExport(
				{ computerId: "local", panelId: PANEL, path: "big.dat" },
				deps({ save: dest }, () => ({ ...endpoint(), port: proxy.port })),
			);
			expect(cut.status).toBe("failed");
		} finally {
			await proxy.close();
		}
		expect(fs.readFileSync(dest, "utf8")).toBe("the user's own file");
		expect(fs.readdirSync(dir)).toEqual(["keep.dat"]);
	});

	if (process.platform !== "win32") {
		test("export replaces a chosen path that is a symlink instead of writing through it", async () => {
			fs.writeFileSync(path.join(storage, "note.txt"), "from the panel");
			const elsewhere = path.join(tempDir(), "elsewhere.txt");
			fs.writeFileSync(elsewhere, "not this one");
			const dest = path.join(tempDir(), "note.txt");
			fs.symlinkSync(elsewhere, dest);
			expect((await runPanelExport({ computerId: "local", panelId: PANEL, path: "note.txt" }, deps({ save: dest }))).status).toBe("exported");
			expect(fs.readFileSync(elsewhere, "utf8")).toBe("not this one");
			expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
			expect(fs.readFileSync(dest, "utf8")).toBe("from the panel");
		});

		test("importing a folder that contains a link is refused before anything is copied", async () => {
			const folder = path.join(tempDir(), "pack");
			fs.mkdirSync(folder);
			fs.writeFileSync(path.join(folder, "a.txt"), "a");
			fs.symlinkSync("/", path.join(folder, "root-link"));
			const result = await runPanelImport({ computerId: "local", panelId: PANEL, path: "imports", selection: "folder" }, deps({ paths: [folder] }));
			expect(result).toMatchObject({ status: "failed", code: "failed" });
			expect((result as { message: string }).message).toContain("root-link");
			expect(fs.existsSync(path.join(storage, "imports", "pack"))).toBe(false);
		});
	}

	test("import replaces the file once fully arrived and keeps the old one when too large", async () => {
		const dir = tempDir();
		fs.writeFileSync(path.join(storage, "save.dat"), "old save");
		const fresh = path.join(dir, "fresh.dat");
		fs.writeFileSync(fresh, bytes(10_000, 5));
		expect(await runPanelImport({ computerId: "local", panelId: PANEL, path: "save.dat" }, deps({ open: fresh }))).toEqual({ status: "imported", name: "fresh.dat", bytes: 10_000 });
		expect(fs.readFileSync(path.join(storage, "save.dat")).equals(bytes(10_000, 5))).toBe(true);

		const huge = path.join(dir, "huge.dat");
		fs.writeFileSync(huge, bytes(100_000));
		const result = await runPanelImport({ computerId: "local", panelId: PANEL, path: "save.dat" }, deps({ open: huge }));
		expect(result).toMatchObject({ status: "failed", code: "too-large" });
		expect(fs.readFileSync(path.join(storage, "save.dat")).equals(bytes(10_000, 5))).toBe(true);
		expect(fs.readdirSync(storage).filter((n) => n.includes(".davpart"))).toEqual([]);
	});

	test("a batch names the file that failed and how many were already copied", async () => {
		const dir = tempDir();
		fs.writeFileSync(path.join(dir, "one.txt"), "1");
		fs.writeFileSync(path.join(dir, "two.bin"), bytes(100_000));
		const result = await runPanelImport(
			{ computerId: "local", panelId: PANEL, path: "batch", selection: "files" },
			deps({ paths: [path.join(dir, "one.txt"), path.join(dir, "two.bin")] }),
		);
		expect(result).toMatchObject({ status: "failed", code: "too-large" });
		expect((result as { message: string }).message).toStartWith("two.bin: ");
		expect((result as { message: string }).message).toContain("1 file was already copied");
		expect(fs.readFileSync(path.join(storage, "batch", "one.txt"), "utf8")).toBe("1");
	});

	test("a request naming a panel other than the asking frame's fails before any dialog", async () => {
		const result = await runPanelFileTransfer("local", PANEL, { kind: "export", requestId: "r1", panelId: "test.someone-else", path: "world.dat" });
		expect(result).toEqual({ status: "failed", code: "invalid-request", message: "The panel id does not match the panel that asked" });
		const missing = deps({ save: path.join(tempDir(), "x") });
		expect((await runPanelExport({ computerId: "local", panelId: PANEL, path: "does-not-exist.dat" }, missing)).status).toBe("failed");
		expect(missing.dialogs).toEqual([]);
	});
});
