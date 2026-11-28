import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RosterMember } from "@mileniumhq/paperapi/protocol";
import { importPairedComputers } from "../src/network/importPairedComputers";
import { Roster } from "../src/network/roster";
import { memberIdOf } from "../src/network/memberId";
import { NETWORK_DIR, RosterRecords, type RosterStore } from "../src/network/rosterStore";
import { ROSTER_PRIVATE_FILE } from "../src/network/rosterPrivate";
import * as crypto from "node:crypto";
import { KEYS_SPACE, ROSTER_SPACE, SELF_SPACE, signRecord } from "../src/network/record";
import { RecordStore } from "../src/network/store";
import { createTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";
import { ED25519_CERT } from "./support/ed25519Cert";
import { standInForJoining } from "./support/standInForJoining";
import { dataDir } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const rosters: Roster[] = [];
afterEach(async () => {
	for (const roster of rosters.splice(0)) await roster.close();
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
		// Inventory: Data loss — paired again without a name, a computer keeps the name the network gave it.
		await roster.update(id, { name: "Far, renamed" });
		expect(await roster.pair({ cert: far.cert, token: "pc_two", dial: { host: "10.0.0.4", port: 45464 }, facts: { os: "linux" } })).toBe(id);
		expect(roster.member(id)!.name).toBe("Far, renamed");
		// a name a person typed while pairing it again is a rename, never dropped
		expect(await roster.pair({ cert: far.cert, token: "pc_two", name: "Far", dial: { host: "10.0.0.4", port: 45464 }, facts: { os: "linux" } })).toBe(id);
		expect(roster.member(id)!.name).toBe("Far");
		await roster.close();

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
	test("a new computer makes one key epoch, once, and lists itself by its key alone", async () => {
		const self = createTlsIdentity();
		const fresh = localDir();
		const first = await openWithRecords(fresh, self);
		expect(first.records.networkKeys()).toMatchObject({ keys: [{ epoch: 0 }], problems: [] });
		// a member by its own key: no roster record is needed to list it
		expect(rosterRecords(first.records)).toEqual({});
		expect(first.roster.list().map((m) => [m.id, m.cert])).toEqual([[first.roster.self, self.cert]]);
		const written = (await first.records.changes(null, 1000)).records.length;
		await first.roster.close();
		// starting again writes nothing: no second epoch
		const again = await openWithRecords(fresh, self);
		expect((await again.records.changes(null, 1000)).records.length).toBe(written);
		expect(again.roster.list().map((m) => m.id)).toEqual([again.roster.self]);

		// the crash: the key was saved, nothing else was
		const crashed = localDir();
		const store = RecordStore.open({ dir: path.join(crashed, NETWORK_DIR), identity: self, membership: { certFor: (id) => (id === memberIdOf(self.cert) ? self.cert : null), admits: () => true } });
		const epoch = await store.createEpoch([self.cert]);
		await store.close();
		const after = await openWithRecords(crashed, self);
		expect(after.records.networkKeys().keys).toEqual([epoch]);
		expect(after.roster.list().map((m) => [m.id, m.cert])).toEqual([[after.roster.self, self.cert]]);
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
		await roster.close();

		// where it was paired and what it said then are this computer's observations, in its own file
		const own = readJson(path.join(dir, ROSTER_PRIVATE_FILE));
		expect(own).toEqual({
			tokens: { [farId]: "pc_far" },
			aliases: {},
			order: [farId, memberIdOf(self.cert)],
			observed: { [farId]: { dial: { host: "10.0.0.2", port: 45464 }, facts: { os: "linux" } } },
		});
		const reopened = await openWithRecords(dir, self);
		expect(reopened.roster.list().map((m) => [m.id, m.name, m.dial, m.cert, m.facts])).toEqual([
			[farId, "Far", { host: "10.0.0.2", port: 45464 }, far.cert, { os: "linux" }],
			[reopened.roster.self, "Desk", undefined, self.cert, expect.objectContaining({ arch: expect.any(String) })],
		]);
		// the records: the computers named, and what this computer says of itself
		expect(rosterRecords(reopened.records)).toEqual({
			[farId]: { name: "Far", cert: far.cert },
			[reopened.roster.self]: { name: "Desk", cert: self.cert },
		});
		expect(reopened.records.list(SELF_SPACE).map((r) => r.id)).toEqual([reopened.roster.self]);
	});

	// Inventory: Security — the roster as stored holds no pairing token and no order: it can be shared with every computer as it is.
	test("nothing private is in a roster record: tokens are in this computer's own owner-only file", async () => {
		const dir = localDir();
		const { roster, records } = await openWithRecords(dir, createTlsIdentity());
		const far = createTlsIdentity();
		const farId = await roster.pair({ cert: far.cert, token: "pc_secret_token", name: "Far", dial: { host: "10.0.0.2", port: 45464 }, facts: {} });
		for (const [, bytes] of filesUnder(path.join(dir, NETWORK_DIR))) expect(bytes).not.toContain("pc_secret_token");
		expect(Object.keys(rosterRecords(records)[farId] as object).sort()).toEqual(["cert", "name"]);
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

	// Inventory: Security — where a computer listens and what it runs are its own word: no member can erase or forge them for another.
	test("only a computer says where it listens and what it runs; any member may rename it; where this one reached it stays here", async () => {
		const self = createTlsIdentity();
		const far = createTlsIdentity();
		const desk = await openWithRecords(localDir(), self);
		const rack = await openWithRecords(localDir(), far);
		const [deskId, rackId] = [desk.roster.self, rack.roster.self];
		await rack.roster.listensAt({ host: "rack.local", port: 45464 });
		// paired from the desk at an IP, told it runs Linux
		await desk.roster.pair({ cert: far.cert, token: "pc_rack", name: "Rack", dial: { host: "192.168.1.20", port: 45464 }, facts: { os: "linux" } });
		expect(desk.records.get(SELF_SPACE, rackId)).toBeNull();
		expect(desk.roster.member(rackId)).toMatchObject({ dial: { host: "192.168.1.20", port: 45464 }, facts: { os: "linux" } });
		expect(desk.roster.dialsOf(rackId)).toEqual([{ host: "192.168.1.20", port: 45464 }]);

		await standInForJoining([
			{ records: desk.records, cert: self.cert },
			{ records: rack.records, cert: far.cert },
		]);
		// the rack's own word reaches the desk: what it runs is its own, where the desk reached it stays first to dial
		expect(desk.roster.member(rackId)!.facts).toEqual(rack.roster.member(rackId)!.facts);
		expect(desk.roster.member(rackId)!.dial).toEqual({ host: "192.168.1.20", port: 45464 });
		expect(desk.roster.dialsOf(rackId)).toEqual([{ host: "192.168.1.20", port: 45464 }, { host: "rack.local", port: 45464 }]);

		// the desk can't write the rack's self record, and one it forged anyway is refused wherever it arrives
		await expect(desk.records.put(SELF_SPACE, rackId, { dial: { host: "evil.local", port: 1 }, facts: {} })).rejects.toThrow("only by the computer it is about");
		const deskKey = crypto.createPrivateKey(self.key);
		const forged = signRecord(
			{ space: SELF_SPACE, id: rackId, wall: Date.now(), counter: 0, author: deskId, deleted: false, epoch: 0, key: "0".repeat(16) },
			Buffer.alloc(64),
			deskKey,
		);
		const applied = await rack.records.apply([forged]);
		expect(applied.refused).toMatchObject([{ reason: "malformed", message: expect.stringContaining("only by the computer it is about") }]);
		// a rename from the desk, which writes the roster record without any address, takes nothing from the rack
		await desk.roster.update(rackId, { name: "Big rack" });
		await rack.records.pull(deskId, desk.records);
		expect(rack.roster.member(rackId)).toMatchObject({ name: "Big rack", dial: { host: "rack.local", port: 45464 } });

		// a new address from here changes no record, only the desk's own file, and the desk's list says so
		const version = desk.records.get(ROSTER_SPACE, rackId)!.version;
		let heard = 0;
		desk.roster.onChange(() => heard++);
		await desk.roster.update(rackId, { dial: { host: "rack.local", address: "10.0.0.9", port: 45464 } });
		expect(desk.records.get(ROSTER_SPACE, rackId)!.version).toBe(version);
		expect(heard).toBe(1);
		expect(desk.roster.view().members.find((m) => m.id === rackId)!.dial).toEqual({ host: "rack.local", address: "10.0.0.9", port: 45464 });
		await rack.records.pull(deskId, desk.records);
		expect(rack.roster.member(rackId)!.dial).toEqual({ host: "rack.local", port: 45464 });
		// and the rack's own address is a name and a port, never an IP one computer saw
		// and the rack's own address is its server's to say at every start: set here, the next start would overwrite it
		await expect(rack.roster.update(rackId, { dial: { host: "rack.local", address: "10.0.0.9", port: 45464 } })).rejects.toThrow("where its Paperboard server listens");
		await expect(rack.roster.update(rackId, { dial: { host: "rack.local", port: 45465 } })).rejects.toThrow("where its Paperboard server listens");
		// a rack that stops listening says so, and the desk dials it where it reached it alone
		await rack.roster.listensAt(null);
		await desk.records.pull(rackId, rack.records);
		expect(desk.roster.dialsOf(rackId)).toEqual([{ host: "rack.local", port: 45464 }, { host: "10.0.0.9", port: 45464 }]);
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
		await roster.close();

		// a record that holds another computer's certificate under A's id
		const store = RecordStore.open({ dir: path.join(dir, NETWORK_DIR), identity: self, membership: { certFor: () => self.cert, admits: () => true } });
		const damaged = await store.put(ROSTER_SPACE, idA, { name: "A", cert: b.cert, facts: {} });
		const reopened = await openWithRecords(dir, self);
		expect(reopened.roster.list().map((m) => m.id)).toEqual([idB, reopened.roster.self]);
		expect(reopened.records.versions(ROSTER_SPACE, idA)[0]).toMatchObject({ version: damaged.version, state: "value" });
		// what the roster won't write, it never lets out of this computer either
		await expect(reopened.roster.pair({ cert: a.cert, token: "pc_a", dial: { host: "10.0.0.2", port: 1 }, facts: { os: "x".repeat(300) } })).rejects.toThrow("OS details are damaged");
		await reopened.roster.close();

		// a key that hashes to its id but isn't a daemon's kind: no record of its could be verified
		await store.put(ROSTER_SPACE, memberIdOf(ED25519_CERT), { cert: ED25519_CERT, facts: {} });
		const again = await openWithRecords(dir, self);
		expect(again.roster.member(memberIdOf(ED25519_CERT))).toBeUndefined();
		expect(again.roster.list().map((m) => m.id)).toEqual([idB, again.roster.self]);
		await again.roster.close();
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

	// Inventory: Data loss — two changes to what this computer says of itself at once keep both: losing the address would leave it undialable.
	test("where this computer listens and what it runs, changed at once, are both kept", async () => {
		const dir = localDir();
		const self = createTlsIdentity();
		const { roster, records } = await openWithRecords(dir, self);
		for (let port = 1; port <= 10; port++) {
			await Promise.all([roster.listensAt({ host: "desk.local", port }), roster.refreshSelfFacts(), roster.update(roster.self, { facts: { os: "linux", osVersion: `${port}` } })]);
			const said = records.get(SELF_SPACE, roster.self);
			expect(said?.state === "value" && said.value).toMatchObject({ dial: { host: "desk.local", port }, facts: { os: expect.any(String) } });
		}
		await roster.close();
		const again = await open(dir, self);
		expect(again.member(again.self)?.dial).toEqual({ host: "desk.local", port: 10 });
	});

	// Inventory: Data loss — closing the roster saves this computer's own file too: a restart in the same process never loses a pairing token.
	test("closing waits for this computer's own file; a damaged one closes the store it was handed", async () => {
		const dir = localDir();
		const self = createTlsIdentity();
		const roster = await Roster.open(dir, self);
		const far = createTlsIdentity();
		// the token is saved first; the store's write after it fails, the roster being closed
		const pairing = roster.pair({ cert: far.cert, token: "pc_far", dial: { host: "10.0.0.2", port: 1 }, facts: {} }).catch((err: Error) => err);
		await roster.close();
		const again = await open(dir, self);
		expect(again.token(memberIdOf(far.cert))).toBe("pc_far");
		expect(await pairing).toBeInstanceOf(Error);
		await again.close();

		fs.writeFileSync(path.join(dir, ROSTER_PRIVATE_FILE), JSON.stringify({ order: "damaged" }));
		const members = await RosterRecords.open(path.join(dir, NETWORK_DIR), self);
		await expect(Roster.open(dir, self, members)).rejects.toThrow("damaged");
		await expect(members.records.put("notes", "x", 1)).rejects.toThrow("is closed");
	});
});

describe("listed, and a member", () => {
	const everything = async (records: RecordStore) => (await records.changes(null, 500)).records;

	// Inventory: Security — pairing lists a computer; only a member sharing the network's keys lets one in.
	test("two computers that paired each other are listed, not members: neither takes the other's records nor loses itself", async () => {
		const [aKey, bKey] = [createTlsIdentity(), createTlsIdentity()];
		const a = await openWithRecords(localDir(), aKey);
		const b = await openWithRecords(localDir(), bKey);
		const [aId, bId] = [memberIdOf(aKey.cert), memberIdOf(bKey.cert)];
		await a.roster.pair({ cert: bKey.cert, token: "pc_b", name: "B", dial: { host: "b.local", port: 45464 }, facts: {} });
		await b.roster.pair({ cert: aKey.cert, token: "pc_a", name: "A", dial: { host: "a.local", port: 45464 }, facts: {} });
		await b.records.put("notes", "x", "written on b");

		expect(a.roster.isMember(aId)).toBe(true);
		expect(a.roster.isMember(bId)).toBe(false);
		// everything b holds, its own record of a among it, is offered to a
		const taken = await a.records.apply(await everything(b.records));
		expect(taken.accepted).toBe(0);
		expect(taken.held).toBeGreaterThan(0);
		expect(a.records.get("notes", "x")).toBeNull();
		// a still lists itself and b, as it wrote them
		expect(a.roster.list().map((m) => m.id).sort()).toEqual([aId, bId].sort());
		expect(a.roster.member(bId)!.name).toBe("B");
		expect(a.roster.member(aId)).toBeDefined();
	});

	test("a computer becomes a member when a member shares the network's keys with it, and its held records are taken then", async () => {
		const [aKey, bKey] = [createTlsIdentity(), createTlsIdentity()];
		const a = await openWithRecords(localDir(), aKey);
		const b = await openWithRecords(localDir(), bKey);
		const bId = memberIdOf(bKey.cert);
		await a.roster.pair({ cert: bKey.cert, token: "pc_b", dial: { host: "b.local", port: 45464 }, facts: {} });
		await b.roster.pair({ cert: aKey.cert, token: "pc_a", dial: { host: "a.local", port: 45464 }, facts: {} });
		await b.records.put("notes", "x", "written on b");
		await a.records.apply(await everything(b.records));
		let told = 0;
		a.roster.onChange(() => told++);

		// what joining does on each side
		await a.records.shareKeys([bKey.cert]);
		await b.records.shareKeys([aKey.cert]);
		expect(a.roster.isMember(bId)).toBe(true);
		expect(told).toBeGreaterThan(0);
		await a.records.apply(await everything(b.records));
		await waitFor("a to take what it held from b", () => a.records.get("notes", "x")?.state === "value");
	});

	test("a record this computer can't read yet takes no one off the list, itself least of all", async () => {
		const [aKey, bKey] = [createTlsIdentity(), createTlsIdentity()];
		const a = await openWithRecords(localDir(), aKey);
		const b = await openWithRecords(localDir(), bKey);
		const aId = memberIdOf(aKey.cert);
		await a.roster.pair({ cert: bKey.cert, token: "pc_b", dial: { host: "b.local", port: 45464 }, facts: {} });
		await b.roster.pair({ cert: aKey.cert, token: "pc_a", dial: { host: "a.local", port: 45464 }, facts: {} });
		await a.records.shareKeys([bKey.cert]);
		await b.records.shareKeys([aKey.cert]);
		await b.records.apply(await everything(a.records));

		// b writes a's record under a new key, shared with a, whose share hasn't reached a yet
		await b.records.createEpoch([bKey.cert, aKey.cert]);
		await b.records.put(ROSTER_SPACE, aId, { cert: aKey.cert, name: "Named on b" });
		await a.records.apply((await everything(b.records)).filter((r) => r.space !== KEYS_SPACE));
		expect(a.records.get(ROSTER_SPACE, aId)?.state).toBe("unreadable");
		expect(a.roster.member(aId)).toBeDefined();
		expect(a.roster.member(aId)!.name).toBeUndefined();
		expect(a.roster.list().map((m) => m.id)).toContain(aId);

		// the key comes, and the record reads
		await a.records.apply(await everything(b.records));
		await waitFor("a to read its record once the key came", () => a.roster.member(aId)?.name === "Named on b");
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
			[roster.self]: { name: "Workstation", cert: self.cert },
			[rack]: { name: "Rack", cert: c.rack },
			[laptop]: { name: "Laptop", cert: c.laptop },
			[twin]: { name: "Twin", cert: c.twin },
		});
		// nothing is said for them: none has spoken for itself yet
		expect(records.list(SELF_SPACE).map((r) => r.id)).toEqual([roster.self]);
		// the selection is the app's, the tokens and the order this computer's own
		for (const [, stored] of filesUnder(path.join(dir, NETWORK_DIR))) {
			for (const secret of ["activeId", "pc_rack", "pc_laptop", "pc_twin_first"]) expect(stored).not.toContain(secret);
		}
		expect(readJson(path.join(dir, ROSTER_PRIVATE_FILE)).order).toEqual([roster.self, rack, laptop, twin]);
		// where 0.4 paired each and what each said then: this computer's own, and how it keeps reaching them
		expect(readJson(path.join(dir, ROSTER_PRIVATE_FILE)).observed).toEqual({
			[rack]: { dial: { host: "rack.local", address: "192.168.1.20", port: 45464 }, facts: roster.member(rack)!.facts },
			[laptop]: { dial: { host: "fe80::1", port: 50000 }, facts: { os: "darwin", arch: "arm64" } },
			[twin]: { dial: { host: "10.0.0.7", port: 45464 }, facts: {} },
		});
		expect(roster.dialsOf(rack)).toEqual([{ host: "rack.local", port: 45464 }, { host: "192.168.1.20", port: 45464 }]);
		await roster.close();

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
		// the computer the app had selected was in that file: it is kept for the app, which may start after this
		expect(readJson(path.join(dir, "active_computer.json"))).toEqual({ activeId: "remote-1731000000000-abc123" });

		// a selection the app already saved is the newer one, and stays
		const chosen = localDir();
		fs.writeFileSync(path.join(chosen, "paired_computers.json"), JSON.stringify(file));
		fs.writeFileSync(path.join(chosen, "active_computer.json"), JSON.stringify({ activeId: "local" }));
		await importPairedComputers(chosen, await open(chosen, createTlsIdentity()));
		expect(readJson(path.join(chosen, "active_computer.json"))).toEqual({ activeId: "local" });

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

		// the disk fills after two computers are saved
		const records = await RosterRecords.open(path.join(dir, NETWORK_DIR), self);
		let writes = 0;
		const failing: RosterStore = {
			members: () => records.members(),
			write: (member) => (++writes > 2 ? Promise.reject(new Error("ENOSPC: no space left on device")) : records.write(member)),
			updateSelf: (change) => records.updateSelf(change),
			remove: (id) => records.remove(id),
			watch: (listener) => records.watch(listener),
			isMember: (id) => records.isMember(id),
			close: () => records.close(),
		};
		const first = await open(dir, self, failing);
		await expect(importPairedComputers(dir, first)).rejects.toThrow("no space left");
		expect(fs.readFileSync(old, "utf8")).toBe(bytes);
		// this computer, listed by its key, and the two saved
		expect(records.members()).toHaveLength(3);
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
