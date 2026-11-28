import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as path from "node:path";
import { TEST_TIMEOUT_MS } from "testkit/wait";
import { startDaemon, stopDaemon, type InProcessDaemon } from "testkit/inproc";
import type { Rpc } from "testkit/rpc";
import {
	SHARED_DOCUMENT_MAX_BYTES,
	SHARED_DOCUMENTS_MAX,
	SHARED_EVENT,
	SHARED_IDS_MAX,
	SHARED_SPACE_MAX_BYTES,
} from "@mileniumhq/paperapi/sharedShape";
import { getPaperboardDir } from "../src/core/paths";
import { memberIdOf } from "../src/network/memberId";
import { KEYS_SPACE, ROSTER_SPACE, signRecord } from "../src/network/record";
import { panelSpace, SHELL_SPACE } from "../src/network/shared";
import { RecordStore } from "../src/network/store";
import { createTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

const ALPHA = "dev.example.alpha";
const BETA = "dev.example.beta";
let farDirs = 0;

const changedFor = (rpc: Rpc, panelId: string | null, id: string) =>
	rpc.upcoming((f) => f?.type === "event" && f.event === SHARED_EVENT && f.payload.panelId === panelId && f.payload.ids.includes(id), 10_000, `${SHARED_EVENT} for ${panelId}/${id}`);

/**
 * Another computer of the daemon's network: paired with it, given its
 * network keys, and holding its own record store, which syncs with the
 * daemon's by pull (as links will carry it).
 */
interface Far {
	identity: TlsIdentity;
	id: string;
	store: RecordStore;
	/** what the far computer wrote reaches the daemon */
	send(): Promise<void>;
	/** what the daemon holds reaches the far computer */
	fetch(): Promise<void>;
}

async function far(daemon: InProcessDaemon, host: Rpc, name: string): Promise<Far> {
	const identity = createTlsIdentity();
	const id = memberIdOf(identity.cert);
	await host.ok("computers:pair", { cert: identity.cert, pairToken: `pc_${name}`, name, dial: { host: "10.0.0.2", port: 45464 }, facts: { os: "linux" } });
	const records = daemon.instance.records;
	await records.shareKeys([identity.cert]);
	const self = daemon.instance.roster.self;
	const selfCert = daemon.instance.roster.member(self)!.cert;
	const certs = new Map([
		[self, selfCert],
		[id, identity.cert],
	]);
	const store = RecordStore.open({
		dir: path.join(getPaperboardDir(), "far", `${name}-${++farDirs}`),
		identity,
		membership: { certFor: (author) => certs.get(author) ?? null, admits: (header) => certs.has(header.author) },
	});
	const computer: Far = {
		identity,
		id,
		store,
		send: async () => {
			await records.pull(name, store);
		},
		fetch: async () => {
			await store.pull("daemon", records);
		},
	};
	await computer.fetch();
	return computer;
}

describe("a panel's shared documents are its own", () => {
	test("by any parameter, a panel reaches its own documents and nothing else: not another panel's, the shell's or the store's own spaces", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const alpha = await daemon.panelRpc(ALPHA);
		const beta = await daemon.panelRpc(BETA);
		await alpha.ok("shared:set", { panelId: ALPHA, id: "settings", value: { mine: "alpha" } });
		await beta.ok("shared:set", { panelId: BETA, id: "settings", value: { mine: "beta" } });
		await host.ok("shared:set", { id: "settings", value: { mine: "shell" } });
		const rosterBefore = daemon.instance.records.list(ROSTER_SPACE).map((r) => r.version);

		// another panel's, or the shell's (no panel named), whatever the action
		const calls: [string, Record<string, unknown>][] = [
			["shared:get", { id: "settings" }],
			["shared:list", {}],
			["shared:set", { id: "settings", value: "taken" }],
			["shared:delete", { id: "settings" }],
			["shared:versions", { id: "settings" }],
			["shared:restore", { id: "settings", version: "0".repeat(64) }],
		];
		for (const [action, params] of calls) {
			for (const panelId of [BETA, undefined]) {
				const refused = await alpha.fail(action, { ...params, ...(panelId ? { panelId } : {}) });
				expect(refused.code).toBe("FORBIDDEN");
			}
		}
		// a space, an owner or a reserved name in any field is no way out
		const own = await alpha.ok("shared:get", { panelId: ALPHA, id: "settings", space: ROSTER_SPACE, owner: null, panel: BETA });
		expect(own.document.value).toEqual({ mine: "alpha" });
		for (const params of [
			{ panelId: ALPHA, id: `${ROSTER_SPACE}/x` },
			{ panelId: ALPHA, id: "../settings" },
			{ panelId: ROSTER_SPACE, id: "settings" },
			{ panelId: KEYS_SPACE, id: "settings" },
			{ panelId: "shell", id: "settings" },
		]) {
			const refused = await alpha.fail("shared:set", { ...params, value: 1 });
			expect(refused.code).toMatch(/INVALID_PARAMS|FORBIDDEN/);
		}
		// a panel named "shell" is a panel: its space is not the shell's
		const shellPanel = await daemon.panelRpc("shell");
		expect((await shellPanel.ok("shared:get", { panelId: "shell", id: "settings" })).document).toBeNull();

		// the host names each, and the shell's is none of the panels'
		expect((await host.ok("shared:get", { panelId: ALPHA, id: "settings" })).document.value).toEqual({ mine: "alpha" });
		expect((await host.ok("shared:get", { panelId: BETA, id: "settings" })).document.value).toEqual({ mine: "beta" });
		expect((await host.ok("shared:get", { id: "settings" })).document.value).toEqual({ mine: "shell" });
		expect((await beta.ok("shared:list", { panelId: BETA })).documents.map((d: any) => d.value)).toEqual([{ mine: "beta" }]);

		// nothing was written anywhere but the three spaces
		const spaces = new Set((await daemon.instance.records.changes(null, 10_000)).records.map((r) => r.space));
		expect([...spaces].sort()).toEqual([KEYS_SPACE, ROSTER_SPACE, SHELL_SPACE, panelSpace(ALPHA), panelSpace(BETA)].sort());
		expect(daemon.instance.records.list(ROSTER_SPACE).map((r) => r.version)).toEqual(rosterBefore);
		expect(panelSpace("shell")).not.toBe(SHELL_SPACE);
	});

	test("a change is heard only by its panel's sockets and the host's", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const alpha = await daemon.panelRpc(ALPHA);
		const beta = await daemon.panelRpc(BETA);
		for (const rpc of [host, alpha, beta]) await rpc.ok("events:subscribe", { events: [SHARED_EVENT, "*"] });
		await alpha.ok("shared:list", { panelId: ALPHA });
		await beta.ok("shared:list", { panelId: BETA });

		const heardByAlpha = changedFor(alpha, ALPHA, "notes");
		const heardByHost = changedFor(host, ALPHA, "notes");
		await alpha.ok("shared:set", { panelId: ALPHA, id: "notes", value: "a" });
		await heardByAlpha;
		await heardByHost;
		// beta's own change comes after alpha's on its socket: had alpha's reached it, it would be here
		const heardByBeta = changedFor(beta, BETA, "notes");
		await beta.ok("shared:set", { panelId: BETA, id: "notes", value: "b" });
		await heardByBeta;
		expect(beta.events(SHARED_EVENT).map((f) => f.payload.panelId)).toEqual([BETA]);
		expect(alpha.events(SHARED_EVENT).map((f) => f.payload.panelId)).toEqual([ALPHA]);

		// the shell's documents reach the host alone
		const shellHeard = changedFor(host, null, "theme");
		await host.ok("shared:set", { id: "theme", value: "dark" });
		await shellHeard;
		const later = changedFor(alpha, ALPHA, "after");
		await alpha.ok("shared:set", { panelId: ALPHA, id: "after", value: 1 });
		await later;
		expect(alpha.events(SHARED_EVENT).some((f) => f.payload.panelId === null)).toBe(false);
	});
});

describe("shared documents through the RPC", () => {
	test("set, get, list, delete and versions, saying which computer wrote each and when", async () => {
		const daemon = await startDaemon();
		const page = await daemon.panelRpc(ALPHA);
		const self = daemon.instance.roster.self;
		const before = Date.now();
		const written = await page.ok("shared:set", { panelId: ALPHA, id: "projects/one", value: { name: "One" } });
		expect(written.overwrote).toBeNull();
		expect(written.document).toMatchObject({ id: "projects/one", state: "value", value: { name: "One" }, author: { computer: self, self: true } });
		expect(written.document.version).toMatch(/^[0-9a-f]{64}$/);
		expect(written.document.writtenAt).toBeGreaterThanOrEqual(before);
		await page.ok("shared:set", { panelId: ALPHA, id: "projects/two", value: { name: "Two" } });
		await page.ok("shared:set", { panelId: ALPHA, id: "settings", value: { theme: "dark" } });

		expect((await page.ok("shared:get", { panelId: ALPHA, id: "projects/one" })).document).toEqual(written.document);
		expect((await page.ok("shared:get", { panelId: ALPHA, id: "nothing" })).document).toBeNull();
		const all = await page.ok("shared:list", { panelId: ALPHA });
		expect(all.documents.map((d: any) => d.id)).toEqual(["projects/one", "projects/two", "settings"]);
		const projects = await page.ok("shared:list", { panelId: ALPHA, prefix: "projects/" });
		expect(projects.documents.map((d: any) => d.value.name)).toEqual(["One", "Two"]);
		const named = await page.ok("shared:list", { panelId: ALPHA, ids: ["settings", "nothing", "projects/two"] });
		expect(named.documents.map((d: any) => d.id)).toEqual(["projects/two", "settings"]);

		expect(await page.ok("shared:delete", { panelId: ALPHA, id: "projects/one" })).toEqual({ deleted: true, overwrote: null });
		expect((await page.ok("shared:get", { panelId: ALPHA, id: "projects/one" })).document).toBeNull();
		// nothing there: nothing is written
		expect(await page.ok("shared:delete", { panelId: ALPHA, id: "projects/one" })).toEqual({ deleted: false, overwrote: null });
		expect(await page.ok("shared:delete", { panelId: ALPHA, id: "never" })).toEqual({ deleted: false, overwrote: null });
		expect((await page.ok("shared:versions", { panelId: ALPHA, id: "never" })).versions).toEqual([]);
		// this computer's own earlier version is replaced, not kept: one version per computer
		const versions = (await page.ok("shared:versions", { panelId: ALPHA, id: "projects/one" })).versions;
		expect(versions.map((v: any) => [v.state, v.author.self])).toEqual([["deleted", true]]);
		// a value that isn't one, and a set without one
		expect((await page.fail("shared:set", { panelId: ALPHA, id: "settings" })).code).toBe("INVALID_PARAMS");
	});

	test("a document is kept across a restart of the daemon", async () => {
		const first = await startDaemon();
		const dataDir = first.dataDir;
		await (await first.panelRpc(ALPHA)).ok("shared:set", { panelId: ALPHA, id: "settings", value: { kept: true } });
		await first.stop();
		const again = await startDaemon({ dataDir });
		const page = await again.panelRpc(ALPHA);
		expect((await page.ok("shared:get", { panelId: ALPHA, id: "settings" })).document.value).toEqual({ kept: true });
	});
});

describe("another computer's changes", () => {
	test("reach a page watching, named by the computer that wrote them", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const laptop = await far(daemon, host, "Laptop");
		const page = await daemon.panelRpc(ALPHA);
		await page.ok("events:subscribe", { events: [SHARED_EVENT] });
		expect((await page.ok("shared:list", { panelId: ALPHA })).documents).toEqual([]);

		await laptop.store.put(panelSpace(ALPHA), "notes", { text: "from the laptop" });
		const heard = changedFor(page, ALPHA, "notes");
		await laptop.send();
		await heard;
		const doc = (await page.ok("shared:get", { panelId: ALPHA, id: "notes" })).document;
		expect(doc).toMatchObject({ state: "value", value: { text: "from the laptop" }, author: { computer: laptop.id, name: "Laptop", self: false } });

		// and what the page writes reaches the laptop
		await page.ok("shared:set", { panelId: ALPHA, id: "notes", value: { text: "from here" }, basedOn: doc.version });
		await laptop.fetch();
		const there = laptop.store.get(panelSpace(ALPHA), "notes");
		expect(there?.state === "value" && there.value).toEqual({ text: "from here" });
	});

	test("a document this computer can't read yet is said to be unreadable, not missing", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const laptop = await far(daemon, host, "Laptop");
		// the laptop moves to a key epoch this computer isn't given
		await laptop.store.createEpoch([laptop.identity.cert]);
		await laptop.store.put(panelSpace(ALPHA), "secret-plan", { text: "later" });
		await laptop.send();
		const page = await daemon.panelRpc(ALPHA);
		const doc = (await page.ok("shared:get", { panelId: ALPHA, id: "secret-plan" })).document;
		expect(doc.state).toBe("unreadable");
		expect(doc.error).toContain("doesn't hold network key");
		expect(doc.author).toMatchObject({ name: "Laptop", self: false });
		expect((await page.ok("shared:list", { panelId: ALPHA })).documents.map((d: any) => [d.id, d.state])).toEqual([["secret-plan", "unreadable"]]);
	});
});

describe("a conflict", () => {
	test("a set based on an older version wins, names what it overwrote, and the loser is kept to restore", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const laptop = await far(daemon, host, "Laptop");
		const page = await daemon.panelRpc(ALPHA);
		const mine = (await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: { name: "Mine" }, basedOn: null })).document;
		await laptop.fetch();
		// the laptop changes it while the page still edits what it read
		await laptop.store.put(panelSpace(ALPHA), "bot", { name: "Laptop's" });
		await laptop.send();

		const write = await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: { name: "Mine, edited" }, basedOn: mine.version });
		expect(write.document.value).toEqual({ name: "Mine, edited" });
		expect(write.overwrote).toMatchObject({ state: "value", value: { name: "Laptop's" }, author: { computer: laptop.id, name: "Laptop", self: false } });

		const versions = (await page.ok("shared:versions", { panelId: ALPHA, id: "bot" })).versions;
		expect(versions.map((v: any) => [v.value.name, v.author.self])).toEqual([
			["Mine, edited", true],
			["Laptop's", false],
		]);
		const restored = (await page.ok("shared:restore", { panelId: ALPHA, id: "bot", version: versions[1].version })).document;
		expect(restored).toMatchObject({ value: { name: "Laptop's" }, author: { self: true } });
		// the restore is a write like any other: it reaches the laptop
		await laptop.fetch();
		const there = laptop.store.get(panelSpace(ALPHA), "bot");
		expect(there?.state === "value" && there.value).toEqual({ name: "Laptop's" });

		// based on what it replaced: nothing overwritten
		expect((await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: { name: "Again" }, basedOn: restored.version })).overwrote).toBeNull();
		// made as new while one exists
		const fresh = await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: { name: "New" }, basedOn: null });
		expect(fresh.overwrote).toMatchObject({ value: { name: "Again" }, author: { self: true } });
		// a delete based on an older version says so too
		const gone = await page.ok("shared:delete", { panelId: ALPHA, id: "bot", basedOn: mine.version });
		expect(gone).toMatchObject({ deleted: true, overwrote: { value: { name: "New" } } });
		// a set over a delete it never saw
		expect((await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: 1, basedOn: fresh.document.version })).overwrote).toMatchObject({ state: "deleted" });
		// based on nothing over a delete: nothing was there
		await page.ok("shared:delete", { panelId: ALPHA, id: "bot" });
		expect((await page.ok("shared:set", { panelId: ALPHA, id: "bot", value: 2, basedOn: null })).overwrote).toBeNull();

		const current = (await page.ok("shared:get", { panelId: ALPHA, id: "bot" })).document;
		expect((await page.fail("shared:restore", { panelId: ALPHA, id: "bot", version: current.version })).code).toBe("INVALID_PARAMS");
		expect((await page.fail("shared:restore", { panelId: ALPHA, id: "bot", version: "f".repeat(64) })).code).toBe("NOT_FOUND");
		expect((await page.fail("shared:set", { panelId: ALPHA, id: "bot", value: 3, basedOn: "not a version" })).code).toBe("INVALID_PARAMS");
	});
});

describe("limits", () => {
	test("a document's size and id", async () => {
		const daemon = await startDaemon();
		const page = await daemon.panelRpc(ALPHA);
		// a JSON string's quotes count
		const fits = "x".repeat(SHARED_DOCUMENT_MAX_BYTES - 2);
		await page.ok("shared:set", { panelId: ALPHA, id: "big", value: fits });
		const over = await page.fail("shared:set", { panelId: ALPHA, id: "big", value: `${fits}x` });
		expect(over.code).toBe("INVALID_PARAMS");
		expect(over.error).toContain(`at most ${SHARED_DOCUMENT_MAX_BYTES}`);
		// UTF-8 bytes, not characters
		expect((await page.fail("shared:set", { panelId: ALPHA, id: "big", value: "é".repeat(SHARED_DOCUMENT_MAX_BYTES / 2) })).code).toBe("INVALID_PARAMS");
		for (const id of ["", "/a", "a/", "a//b", ".hidden", "a b", "x".repeat(201), "ünï"]) {
			expect((await page.fail("shared:set", { panelId: ALPHA, id, value: 1 })).code).toBe("INVALID_PARAMS");
		}
		await page.ok("shared:set", { panelId: ALPHA, id: `a/${"x".repeat(198)}`, value: 1 });
	});

	test("the documents a panel holds, and all their bytes", async () => {
		const daemon = await startDaemon();
		const page = await daemon.panelRpc(ALPHA);
		const near = "x".repeat(SHARED_DOCUMENT_MAX_BYTES - 1024);
		const fit = Math.floor(SHARED_SPACE_MAX_BYTES / (near.length + 2 + 28));
		for (let i = 0; i < fit; i++) await page.ok("shared:set", { panelId: ALPHA, id: `big-${i}`, value: near });
		const full = await page.fail("shared:set", { panelId: ALPHA, id: "one-more", value: near });
		expect(full.error).toContain(`at most ${SHARED_SPACE_MAX_BYTES}`);
		// replacing a document counts it once
		await page.ok("shared:set", { panelId: ALPHA, id: "big-0", value: near });
		// another panel has its own room
		await (await daemon.panelRpc(BETA)).ok("shared:set", { panelId: BETA, id: "one-more", value: near });
		for (let i = 0; i < fit; i++) await page.ok("shared:delete", { panelId: ALPHA, id: `big-${i}` });

		for (let i = 0; i < SHARED_DOCUMENTS_MAX; i++) await page.ok("shared:set", { panelId: ALPHA, id: `small-${i}`, value: i });
		const many = await page.fail("shared:set", { panelId: ALPHA, id: "small-next", value: 0 });
		expect(many.code).toBe("INVALID_PARAMS");
		expect(many.error).toContain(`${SHARED_DOCUMENTS_MAX} documents`);
		// a deleted one makes room; changing one there takes none
		await page.ok("shared:set", { panelId: ALPHA, id: "small-0", value: "changed" });
		await page.ok("shared:delete", { panelId: ALPHA, id: "small-1" });
		await page.ok("shared:set", { panelId: ALPHA, id: "small-next", value: 0 });
	});

	test("the ids a panel has used, deleted ones included", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const laptop = await far(daemon, host, "Laptop");
		const records = daemon.instance.records;
		const key = records.networkKeys().current!;
		// deletes of SHARED_IDS_MAX ids, from the laptop, all at once
		const privateKey = (await import("node:crypto")).createPrivateKey(laptop.identity.key);
		const deletes = Array.from({ length: SHARED_IDS_MAX }, (_, i) =>
			signRecord({ space: panelSpace(ALPHA), id: `gone-${i}`, wall: Date.now(), counter: i, author: laptop.id, deleted: true, epoch: key.epoch, key: key.id }, Buffer.alloc(0), privateKey),
		);
		expect((await records.apply(deletes)).accepted).toBe(SHARED_IDS_MAX);
		const page = await daemon.panelRpc(ALPHA);
		const refused = await page.fail("shared:set", { panelId: ALPHA, id: "new", value: 1 });
		expect(refused.code).toBe("INVALID_PARAMS");
		expect(refused.error).toContain(`${SHARED_IDS_MAX} document ids`);
		// an id used before is no new one
		await page.ok("shared:set", { panelId: ALPHA, id: "gone-7", value: "back" });
		expect((await page.ok("shared:get", { panelId: ALPHA, id: "gone-7" })).document.value).toBe("back");
	});
});
