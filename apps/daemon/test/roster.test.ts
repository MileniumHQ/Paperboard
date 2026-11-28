import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RosterMember } from "@mileniumhq/paperapi/protocol";
import { importPairedComputers } from "../src/network/importPairedComputers";
import { Roster } from "../src/network/roster";
import { memberIdOf } from "../src/network/memberId";
import { NETWORK_DIR, RosterRecords, type RosterStore } from "../src/network/rosterStore";
import { ROSTER_PRIVATE_FILE } from "../src/network/rosterPrivate";
import { ROSTER_SPACE } from "../src/network/record";
import { RecordStore } from "../src/network/store";
import { createTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";
import { dataDir } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const rosters: Roster[] = [];
afterEach(async () => {
	for (const roster of rosters.splice(0)) roster.close();
	await stopDaemon();
});

const localDir = () => {
	const dir = path.join(dataDir(), "local");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
};
const open = async (dir: string, identity: TlsIdentity, store?: RosterStore) => {
	const roster = await Roster.open(dir, identity, store);
	rosters.push(roster);
	return roster;
};
/** a roster over its own record store, with the store at hand to look into */
const openWithRecords = async (dir: string, identity: TlsIdentity) => {
	const members = await RosterRecords.open(path.join(dir, NETWORK_DIR), identity);
	return { roster: await open(dir, identity, members), records: members.records };
};
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
/** every file under a folder, with its bytes */
const filesUnder = (dir: string) =>
	fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as const);
/** the roster's records as the store holds them: each member's value by its id */
const rosterRecords = (records: RecordStore) =>
	Object.fromEntries(records.list(ROSTER_SPACE).map((r) => [r.id, r.state === "value" ? r.value : r.state]));

// what 0.4's desktop app wrote: This Computer first, renamed, then two
// paired computers (one at its .local name and its last IP), a third paired
// twice under one key, and entries a hand edit or a crash left damaged
function shippedFile(certs: { rack: string; laptop: string; twin: string }) {
	return {
		activeId: "remote-1731000000000-abc123",
		computers: [
			{ id: "local", name: "Workstation", host: "127.0.0.1", port: 45464, isLocal: true, os: "linux", arch: "x64" },
			{
				id: "remote-1731000000000-abc123", name: "Rack", host: "rack.local", address: "192.168.1.20", port: 45464,
				token: "pc_rack", cert: certs.rack, os: "linux", osVersion: "24.04", distroId: "ubuntu", distroName: "Ubuntu", arch: "x64",
				machine: { id: "proxmox", name: "Proxmox VE" }, isLocal: false,
			},
			{ id: "remote-1731000000001-def456", name: "Laptop", host: "[fe80::1]", port: 50000, token: "pc_laptop", cert: certs.laptop, os: "darwin", arch: "arm64", isLocal: false },
			{ id: "remote-1731000000002-ghi789", name: "Twin", host: "10.0.0.7", port: 45464, token: "pc_twin_first", cert: certs.twin, isLocal: false },
			{ id: "remote-1731000000003-jkl012", name: "Twin again", host: "10.0.0.8", port: 45464, token: "pc_twin_second", cert: certs.twin, isLocal: false },
			{ id: "remote-1731000000004-mno345", name: "No cert", host: "10.0.0.9", port: 45464, token: "pc_lost" },
			{ id: "remote-1731000000005-pqr678", name: "Bad cert", host: "10.0.0.10", port: 45464, token: "pc_bad", cert: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----\n" },
			"not a computer",
		],
	};
}

describe("the roster", () => {
	test("a computer's id comes from its key: the same certificate gives the same id, at any address and across restarts", async () => {
		const dir = localDir();
		const self = createTlsIdentity();
		const far = createTlsIdentity();
		const id = memberIdOf(far.cert);
		expect(id).toMatch(/^[0-9a-f]{40}$/);
		expect(memberIdOf(far.cert)).toBe(id);
		expect(memberIdOf(createTlsIdentity().cert)).not.toBe(id);

		const roster = await open(dir, self);
		expect(roster.self).toBe(memberIdOf(self.cert));
		expect(await roster.pair({ cert: far.cert, token: "pc_one", name: "Far", dial: { host: "10.0.0.2", port: 45464 }, facts: { os: "linux" } })).toBe(id);
		await roster.update(id, { dial: { host: "far.local", address: "10.0.0.3", port: 45465 } });
		// paired again from a new address: one member, its name and place kept, the new token
		expect(await roster.pair({ cert: far.cert, token: "pc_two", dial: { host: "10.0.0.4", port: 45464 }, facts: { os: "linux" } })).toBe(id);
		roster.close();

		const reopened = await open(dir, self);
		expect(reopened.self).toBe(memberIdOf(self.cert));
		expect(reopened.list().map((m) => [m.id, m.name, m.dial])).toEqual([
			[reopened.self, undefined, undefined],
			[id, "Far", { host: "10.0.0.4", port: 45464 }],
		]);
		expect(reopened.token(id)).toBe("pc_two");
		await expect(reopened.pair({ cert: self.cert, token: "pc_me", dial: { host: "127.0.0.1", port: 45464 }, facts: {} })).rejects.toThrow("this computer's own Paperboard server");
	});

	// Inventory: Data loss — a new computer makes its first network key and lists itself exactly once, whatever start a crash cuts short.
	test("a new computer makes one key epoch and its own record, once, and a crash between the two only writes the record", async () => {
		const self = createTlsIdentity();
		const fresh = localDir();
		const first = await openWithRecords(fresh, self);
		expect(first.records.networkKeys()).toMatchObject({ keys: [{ epoch: 0 }], problems: [] });
		expect(Object.keys(rosterRecords(first.records))).toEqual([first.roster.self]);
		const written = (await first.records.changes(null, 1000)).records.length;
		first.roster.close();
		// starting again writes nothing: no second epoch, no second version of this computer
		const again = await openWithRecords(fresh, self);
		expect((await again.records.changes(null, 1000)).records.length).toBe(written);
		expect(again.roster.list().map((m) => m.id)).toEqual([again.roster.self]);

		// the crash: the key was saved, this computer's record never was
		const crashed = localDir();
		const store = RecordStore.open({ dir: path.join(crashed, NETWORK_DIR), identity: self, membership: { certFor: (id) => (id === memberIdOf(self.cert) ? self.cert : null), admits: () => true } });
		const epoch = await store.createEpoch([self.cert]);
		const after = await openWithRecords(crashed, self);
		expect(after.records.networkKeys().keys).toEqual([epoch]);
		expect(after.roster.list().map((m) => [m.id, m.cert])).toEqual([[after.roster.self, self.cert]]);
		expect(after.records.versions(ROSTER_SPACE, after.roster.self)).toHaveLength(1);
	});

	// Inventory: Data loss — the computer list is the records: names, addresses and certificates come back from them after a restart.
	test("the list survives a restart from its records alone; the order and tokens are this computer's own file", async () => {
		const dir = localDir();
		const self = createTlsIdentity();
		const far = createTlsIdentity();
		const { roster } = await openWithRecords(dir, self);
		const farId = await roster.pair({ cert: far.cert, token: "pc_far", name: "Far", dial: { host: "10.0.0.2", port: 45464 }, facts: { os: "linux" } });
		await roster.update(roster.self, { name: "Desk" });
		await roster.reorder([farId, roster.self]);
		roster.close();

		// the private file names no computer and no address
		const own = readJson(path.join(dir, ROSTER_PRIVATE_FILE));
		expect(own).toEqual({ tokens: { [farId]: "pc_far" }, aliases: {}, order: [farId, memberIdOf(self.cert)] });
		const reopened = await openWithRecords(dir, self);
		expect(reopened.roster.list().map((m) => [m.id, m.name, m.dial, m.cert])).toEqual([
			[farId, "Far", { host: "10.0.0.2", port: 45464 }, far.cert],
			[reopened.roster.self, "Desk", undefined, self.cert],
		]);
		expect(rosterRecords(reopened.records)).toEqual({
			[farId]: { name: "Far", dial: { host: "10.0.0.2", port: 45464 }, cert: far.cert, facts: { os: "linux" } },
			[reopened.roster.self]: { name: "Desk", cert: self.cert, facts: expect.any(Object) },
		});
	});

	// Inventory: Security — the roster as stored holds no pairing token and no order: it can be shared with every computer as it is.
	test("nothing private is in a roster record: tokens are in this computer's own owner-only file", async () => {
		const dir = localDir();
		const { roster, records } = await openWithRecords(dir, createTlsIdentity());
		const far = createTlsIdentity();
		const farId = await roster.pair({ cert: far.cert, token: "pc_secret_token", name: "Far", dial: { host: "10.0.0.2", port: 45464 }, facts: {} });
		for (const [, bytes] of filesUnder(path.join(dir, NETWORK_DIR))) expect(bytes).not.toContain("pc_secret_token");
		expect(Object.keys(rosterRecords(records)[farId] as object).sort()).toEqual(["cert", "dial", "facts", "name"]);
		expect(readJson(path.join(dir, ROSTER_PRIVATE_FILE)).tokens).toEqual({ [farId]: "pc_secret_token" });
		if (process.platform !== "win32") {
			expect(fs.statSync(path.join(dir, ROSTER_PRIVATE_FILE)).mode & 0o777).toBe(0o600);
			expect(fs.statSync(path.join(dir, NETWORK_DIR)).mode & 0o777).toBe(0o700);
		}
		// forgotten, its token goes with it, and its record is a delete
		await roster.remove(farId);
		expect(readJson(path.join(dir, ROSTER_PRIVATE_FILE)).tokens).toEqual({});
		expect(records.get(ROSTER_SPACE, farId)).toBeNull();
		expect(records.versions(ROSTER_SPACE, farId)[0]).toMatchObject({ state: "deleted" });
	});

	test("a reorder must name every computer and writes no record; a damaged member record is left out and kept, the rest still load", async () => {
		const dir = localDir();
		const self = createTlsIdentity();
		const { roster, records } = await openWithRecords(dir, self);
		const [a, b] = [createTlsIdentity(), createTlsIdentity()];
		const idA = await roster.pair({ cert: a.cert, token: "pc_a", name: "A", dial: { host: "10.0.0.2", port: 1 }, facts: {} });
		const idB = await roster.pair({ cert: b.cert, token: "pc_b", name: "B", dial: { host: "10.0.0.3", port: 1 }, facts: {} });
		await expect(roster.reorder([idB, roster.self])).rejects.toThrow("changed while you were reordering");
		const before = (await records.changes(null, 1000)).records.length;
		await roster.reorder([idB, roster.self, idA]);
		expect(roster.list().map((m) => m.id)).toEqual([idB, roster.self, idA]);
		expect((await records.changes(null, 1000)).records.length).toBe(before);
		roster.close();

		// a record that holds another computer's certificate under A's id
		const store = RecordStore.open({ dir: path.join(dir, NETWORK_DIR), identity: self, membership: { certFor: () => self.cert, admits: () => true } });
		const damaged = await store.put(ROSTER_SPACE, idA, { name: "A", cert: b.cert, facts: {} });
		const reopened = await openWithRecords(dir, self);
		expect(reopened.roster.list().map((m) => m.id)).toEqual([idB, reopened.roster.self]);
		expect(reopened.records.versions(ROSTER_SPACE, idA)[0]).toMatchObject({ version: damaged.version, state: "value" });
		// what the roster won't write, it never lets out of this computer either
		await expect(reopened.roster.pair({ cert: a.cert, token: "pc_a", dial: { host: "10.0.0.2", port: 1 }, facts: { os: "x".repeat(300) } })).rejects.toThrow("OS details are damaged");
	});

	test("a daemon given a new key is a new computer: its list starts over, and the old one is kept aside untouched", async () => {
		const dir = localDir();
		const before = await open(dir, createTlsIdentity());
		const far = createTlsIdentity();
		const farId = await before.pair({ cert: far.cert, token: "pc_far", name: "Far", dial: { host: "10.0.0.2", port: 1 }, facts: {} });
		await before.update(before.self, { name: "Workstation" });
		before.close();
		const old = filesUnder(path.join(dir, NETWORK_DIR));

		const after = await open(dir, createTlsIdentity());
		expect(after.list().map((m) => [m.id, m.name])).toEqual([[after.self, undefined]]);
		// a token kept for a computer that isn't listed is never handed out
		expect(after.view().tokens).toEqual({});
		expect(after.token(farId)).toBe("pc_far");
		const [aside] = fs.readdirSync(dir).filter((f) => f.startsWith(`${NETWORK_DIR}.replaced-`));
		expect(filesUnder(path.join(dir, aside!))).toEqual(old);
	});
});

describe("importing 0.4's paired_computers.json", () => {
	const certs = () => ({ rack: createTlsIdentity().cert, laptop: createTlsIdentity().cert, twin: createTlsIdentity().cert });

	test("every usable pairing is imported with its token and place, old ids keep naming it, and what wasn't usable is kept aside", async () => {
		const dir = localDir();
		const c = certs();
		const old = path.join(dir, "paired_computers.json");
		fs.writeFileSync(old, JSON.stringify(shippedFile(c), null, 2), { mode: 0o600 });
		const bytes = fs.readFileSync(old, "utf8");
		const self = createTlsIdentity();
		const { roster, records } = await openWithRecords(dir, self);
		await importPairedComputers(dir, roster);

		const [rack, laptop, twin] = [memberIdOf(c.rack), memberIdOf(c.laptop), memberIdOf(c.twin)];
		expect(roster.list().map((m) => [m.id, m.name, m.dial])).toEqual([
			[roster.self, "Workstation", undefined],
			[rack, "Rack", { host: "rack.local", address: "192.168.1.20", port: 45464 }],
			[laptop, "Laptop", { host: "fe80::1", port: 50000 }],
			// two entries for one key are one computer, as the first had it
			[twin, "Twin", { host: "10.0.0.7", port: 45464 }],
		]);
		expect(roster.member(rack)!.facts).toEqual({ os: "linux", osVersion: "24.04", distroId: "ubuntu", distroName: "Ubuntu", machine: { id: "proxmox", name: "Proxmox VE" }, arch: "x64" });
		expect([roster.token(rack), roster.token(laptop), roster.token(twin)]).toEqual(["pc_rack", "pc_laptop", "pc_twin_first"]);

		// Inventory: Core contract — an id 0.4 gave a computer still names it, for good.
		expect(roster.resolve("local")).toBe(roster.self);
		expect(roster.resolve("remote-1731000000000-abc123")).toBe(rack);
		expect(roster.resolve("remote-1731000000002-ghi789")).toBe(twin);
		expect(roster.resolve("remote-1731000000003-jkl012")).toBe(twin);
		expect(roster.resolve(rack)).toBe(rack);
		expect(roster.resolve("remote-1731000000004-mno345")).toBeNull();

		// the entries that couldn't be imported keep the whole file's bytes
		expect(fs.existsSync(old)).toBe(false);
		const [kept] = fs.readdirSync(dir).filter((f) => f.startsWith("paired_computers.json.corrupt-"));
		expect(fs.readFileSync(path.join(dir, kept!), "utf8")).toBe(bytes);
		// Inventory: Data loss — what 0.4 paired lands in the record store, one record per computer, and nothing else does.
		expect(rosterRecords(records)).toEqual({
			[roster.self]: { name: "Workstation", cert: self.cert, facts: expect.any(Object) },
			[rack]: { name: "Rack", dial: { host: "rack.local", address: "192.168.1.20", port: 45464 }, cert: c.rack, facts: roster.member(rack)!.facts },
			[laptop]: { name: "Laptop", dial: { host: "fe80::1", port: 50000 }, cert: c.laptop, facts: { os: "darwin", arch: "arm64" } },
			[twin]: { name: "Twin", dial: { host: "10.0.0.7", port: 45464 }, cert: c.twin, facts: {} },
		});
		// the selection is the app's, the tokens and the order this computer's own
		for (const [, stored] of filesUnder(path.join(dir, NETWORK_DIR))) {
			for (const secret of ["activeId", "pc_rack", "pc_laptop", "pc_twin_first"]) expect(stored).not.toContain(secret);
		}
		expect(readJson(path.join(dir, ROSTER_PRIVATE_FILE)).order).toEqual([roster.self, rack, laptop, twin]);
		roster.close();

		// across a restart, the same ids and the same aliases
		const reopened = await open(dir, self);
		expect(reopened.list().map((m) => m.id)).toEqual([reopened.self, rack, laptop, twin]);
		expect(reopened.resolve("remote-1731000000001-def456")).toBe(laptop);
	});

	test("a file that is entirely usable is deleted once imported; one that doesn't parse is kept aside and imports nothing", async () => {
		const dir = localDir();
		const c = certs();
		const file = shippedFile(c);
		file.computers = file.computers.slice(0, 3);
		fs.writeFileSync(path.join(dir, "paired_computers.json"), JSON.stringify(file));
		const roster = await open(dir, createTlsIdentity());
		await importPairedComputers(dir, roster);
		expect(fs.readdirSync(dir).filter((f) => f.startsWith("paired_computers.json"))).toEqual([]);
		expect(roster.list()).toHaveLength(3);

		const broken = localDir();
		fs.writeFileSync(path.join(broken, "paired_computers.json"), "{\"computers\": [");
		const empty = await open(broken, createTlsIdentity());
		await importPairedComputers(broken, empty);
		expect(empty.list().map((m) => m.id)).toEqual([empty.self]);
		const [kept] = fs.readdirSync(broken).filter((f) => f.startsWith("paired_computers.json.corrupt-"));
		expect(fs.readFileSync(path.join(broken, kept!), "utf8")).toBe("{\"computers\": [");
	});

	// Inventory: Data loss — an import that fails halfway loses no pairing: the old file stays, and the next start imports it.
	test("an import that fails halfway leaves the old file as it was, and the next start imports it all", async () => {
		const dir = localDir();
		const c = certs();
		const old = path.join(dir, "paired_computers.json");
		fs.writeFileSync(old, JSON.stringify(shippedFile(c)));
		const bytes = fs.readFileSync(old, "utf8");
		const self = createTlsIdentity();

		// the disk fills after the first computer is saved
		const records = await RosterRecords.open(path.join(dir, NETWORK_DIR), self);
		let writes = 0;
		const failing: RosterStore = {
			members: () => records.members(),
			write: (member: RosterMember) => (++writes > 2 ? Promise.reject(new Error("ENOSPC: no space left on device")) : records.write(member)),
			remove: (id) => records.remove(id),
			watch: (listener) => records.watch(listener),
			close: () => records.close(),
		};
		const first = await open(dir, self, failing);
		await expect(importPairedComputers(dir, first)).rejects.toThrow("no space left");
		expect(fs.readFileSync(old, "utf8")).toBe(bytes);
		expect(records.members()).toHaveLength(2);
		first.close();

		const second = await open(dir, self);
		await importPairedComputers(dir, second);
		expect(second.list().map((m) => m.name)).toEqual(["Workstation", "Rack", "Laptop", "Twin"]);
		expect(second.token(memberIdOf(c.laptop))).toBe("pc_laptop");
		expect(second.resolve("remote-1731000000001-def456")).toBe(memberIdOf(c.laptop));
	});
});

describe("the roster over RPC", () => {
	// Inventory: Security — the computer list and its tokens answer this computer's own host credential only.
	test("only this computer's own host credential may read or change the computer list", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const view = await host.ok("computers:list");
		expect(view.self).toBe(daemon.instance.roster.self);
		expect(view.members.map((m: RosterMember) => m.id)).toEqual([daemon.instance.roster.self]);

		const code = daemon.instance.auth.startPairing();
		const paired = daemon.instance.auth.pair(code, "another computer", "127.0.0.1").token!;
		const { Rpc } = await import("testkit/rpc");
		const remote = await Rpc.authed(daemon.url, paired);
		const panel = await daemon.panelRpc("test.roster");
		for (const socket of [remote, panel]) {
			expect((await socket.fail("computers:list")).code).toBe("FORBIDDEN");
			expect((await socket.fail("computers:remove", { id: "local" })).code).toBe("FORBIDDEN");
		}
		const far = createTlsIdentity();
		const answer = await host.ok("computers:pair", { cert: far.cert, pairToken: "pc_far", name: "Far", dial: { host: "10.0.0.2", port: 45464 }, facts: { os: "linux" } });
		expect(answer.id).toBe(memberIdOf(far.cert));
		expect(answer.tokens).toEqual({ [answer.id]: "pc_far" });
		expect((await host.fail("computers:update", { id: answer.id, name: "   " })).error).toContain("needs a name");
		expect((await host.fail("computers:remove", { id: "local" })).error).toContain("can't be forgotten");
		remote.ws.close();
		panel.ws.close();
		host.ws.close();
	});
});
