import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getPaperboardDir } from "../src/core/paths";
import {
	KEYS_SPACE,
	type RecordHeader,
	type WireRecord,
	headerOf,
	keysRecordId,
	newNetworkKey,
	parseWireRecord,
	recordDigest,
	signRecord,
	wrapKeys,
} from "../src/network/record";
import { memberIdOf } from "../src/network/memberId";
import {
	FUTURE_TOLERANCE_MS,
	MAX_HELD,
	MAX_VERSIONS,
	type Membership,
	RecordStore,
	RecordStoreCorruptError,
	RecordStoreOwnerError,
	SPACE_BUCKETS,
} from "../src/network/store";
import { createTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";
import type { ChangeBatch, ChangeCursor, RecordSource } from "../src/network/store";
import { TEST_TIMEOUT_MS } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// Clocks are the test's: every computer reads `wall`, plus its own offset.
const T0 = 1_800_000_000_000;
let wall = T0;
let dirs = 0;

/** What one computer knows about the others. Tests change it to stand in for the roster. */
class Roster implements Membership {
	readonly certs = new Map<string, string>();
	/** authors whose records are refused, from their clock on */
	readonly removedFrom = new Map<string, number>();
	asked = 0;
	certFor(author: string): string | null {
		return this.certs.get(author) ?? null;
	}
	admits(header: RecordHeader): boolean {
		this.asked++;
		const removed = this.removedFrom.get(header.author);
		return this.certs.has(header.author) && (removed === undefined || header.wall < removed);
	}
	know(...computers: Computer[]): this {
		for (const c of computers) this.certs.set(c.id, c.identity.cert);
		return this;
	}
}

interface Computer {
	name: string;
	identity: TlsIdentity;
	id: string;
	dir: string;
	roster: Roster;
	offset: number;
	store: RecordStore;
	reopen(): RecordStore;
}

function newDir(name: string): string {
	return path.join(getPaperboardDir(), "network", `${name}-${++dirs}`);
}

function computer(name: string, roster = new Roster(), identity = createTlsIdentity()): Computer {
	const c = {
		name,
		identity,
		id: memberIdOf(identity.cert),
		dir: newDir(name),
		roster,
		offset: 0,
		reopen() {
			c.store = RecordStore.open({ dir: c.dir, identity: c.identity, membership: c.roster, now: () => wall + c.offset });
			return c.store;
		},
	} as Computer;
	c.reopen();
	return c;
}

/** Computers that all know each other, holding a network key epoch 0 made by the first. */
async function network(...names: string[]): Promise<Computer[]> {
	wall = T0;
	const computers = names.map((n) => computer(n));
	for (const c of computers) c.roster.know(...computers);
	await computers[0].store.createEpoch(computers.map((c) => c.identity.cert));
	await syncAll(computers);
	return computers;
}

/** Every computer pulls from every other until a whole round brings nothing new. */
async function syncAll(computers: Computer[]): Promise<void> {
	for (let round = 0; round < 20; round++) {
		let accepted = 0;
		for (const to of computers) {
			for (const from of computers) if (to !== from) accepted += (await to.store.pull(from.name, from.store)).accepted;
		}
		if (!accepted) return;
	}
	throw new Error("the stores never settled");
}

/** Everything about a record a computer holds: each kept version and what it reads as. */
function snapshot(store: RecordStore, space: string, ids: string[]) {
	return ids.map((id) =>
		store.versions(space, id).map((v) => [v.version, v.author, v.state, v.state === "value" ? v.value : null]),
	);
}

async function ownRecords(store: RecordStore, space: string): Promise<WireRecord[]> {
	return (await store.changes(null, 10_000)).records.filter((r) => r.space === space);
}

function permutations<T>(items: T[]): T[][] {
	if (items.length <= 1) return [items];
	return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// a seeded generator, so a failing shuffle fails the same way again
function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle<T>(items: T[], next: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** where a record id's bucket of a space is kept (store.ts "Disk") */
function bucketFile(dir: string, space: string, id: string): string {
	const bucket = crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 2);
	return path.join(dir, "spaces", Buffer.from(space, "utf8").toString("hex"), `${bucket}.json`);
}

/** ids that fall in different buckets, the first `n` found */
function idsInDistinctBuckets(n: number): string[] {
	const seen = new Map<string, string>();
	for (let i = 0; seen.size < n; i++) {
		const id = `doc-${i}`;
		const bucket = crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 2);
		if (!seen.has(bucket)) seen.set(bucket, id);
	}
	return [...seen.values()];
}

const value = (store: RecordStore, space: string, id: string) => {
	const r = store.get(space, id);
	return r && (r.state === "value" ? r.value : r.state);
};

describe("records converge", () => {
	// Concurrent writes to one record (two at the very same clock), a later
	// delete over them, and a write against a delete at the same clock.
	async function conflicting(): Promise<{ computers: Computer[]; records: WireRecord[] }> {
		const computers = await network("a", "b", "c", "d");
		const [a, b, c] = computers;
		wall = T0 + 1000;
		await a.store.put("notes", "x", { by: "a" });
		await b.store.put("notes", "x", { by: "b" });
		wall = T0 + 1001;
		await c.store.put("notes", "y", { by: "c" });
		await c.store.delete("notes", "x");
		wall = T0 + 1002;
		await a.store.put("notes", "y", { by: "a" });
		await b.store.delete("notes", "y");
		const records = [
			...(await ownRecords(a.store, "notes")),
			...(await ownRecords(b.store, "notes")),
			...(await ownRecords(c.store, "notes")),
		];
		return { computers, records };
	}

	test("every order of the same writes, and the same again, ends the same", async () => {
		const { computers, records } = await conflicting();
		const d = computers[3];
		expect(records.length).toBe(6);
		const template = d.dir;
		let first: unknown;
		for (const [n, order] of permutations(records).entries()) {
			const dir = newDir("d");
			fs.cpSync(template, dir, { recursive: true });
			const store = RecordStore.open({ dir, identity: d.identity, membership: d.roster, now: () => wall });
			// one batch, and now and then one record per batch, saved in between
			if (n % 10) expect((await store.apply(order)).accepted).toBe(6);
			else for (const r of order) expect((await store.apply([r])).accepted).toBe(1);
			// the same records again, any number of times, change nothing
			const again = await store.apply([...order].reverse());
			expect(again.accepted).toBe(0);
			expect(again.known).toBe(6);
			const state = snapshot(store, "notes", ["x", "y"]);
			if (first === undefined) first = state;
			else expect(state).toEqual(first as typeof state);
		}

		// what each wins is the rule's answer, and what loses is kept
		const [a, b, c] = computers;
		await syncAll(computers.slice(0, 3));
		for (const comp of computers.slice(0, 3)) expect(snapshot(comp.store, "notes", ["x", "y"])).toEqual(first as never);
		expect(a.store.get("notes", "x")).toBeNull();
		expect(a.store.versions("notes", "x").map((v) => [v.author, v.state])).toEqual([
			[c.id, "deleted"],
			...[a, b].sort((p, q) => (p.id < q.id ? 1 : -1)).map((p) => [p.id, "value"]),
		]);
		// a and b wrote y at the same clock: the author that sorts last wins
		const yWinner = a.id > b.id ? { by: "a" } : "deleted";
		expect(value(a.store, "notes", "y") ?? "deleted").toEqual(yWinner);
	});

	test("three stores gossiping in random orders, with duplicated and reversed deliveries, converge", async () => {
		const { computers } = await conflicting();
		const stores = computers.slice(0, 3);
		const next = random(7);
		for (let round = 0; round < 200; round++) {
			const [to, from] = shuffle(stores, next);
			// from anywhere in the other's log, a few at a time
			const { log } = await from.store.changes(null, 1);
			const batch = await from.store.changes({ log, after: Math.floor(next() * 12) }, 1 + Math.floor(next() * 4));
			const records = next() < 0.5 ? batch.records : [...batch.records].reverse();
			await to.store.apply(next() < 0.3 ? [...records, ...records] : records);
		}
		await syncAll(stores);
		const expected = snapshot(stores[0].store, "notes", ["x", "y"]);
		for (const c of stores) expect(snapshot(c.store, "notes", ["x", "y"])).toEqual(expected);
	});

	test("at the same clock the author that sorts last wins, whatever the digests", async () => {
		const [a, b] = await network("a", "b");
		const last = a.id > b.id ? a : b;
		for (let i = 0; i < 16; i++) {
			wall = T0 + 1000 + i;
			await a.store.put("notes", `k${i}`, "a");
			await b.store.put("notes", `k${i}`, "b");
		}
		await syncAll([a, b]);
		for (let i = 0; i < 16; i++) {
			const [winner, loser] = a.store.versions("notes", `k${i}`);
			expect([winner.wall, winner.counter]).toEqual([loser.wall, loser.counter]);
			expect(winner.author).toBe(last.id);
		}
	});

	test("the loser of a conflict is kept, and writing it again brings it back everywhere", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await a.store.put("notes", "x", "from a");
		await b.store.put("notes", "x", "from b");
		await syncAll([a, b]);
		const [winner, loser] = b.store.versions("notes", "x");
		expect(a.store.versions("notes", "x").map((v) => v.version)).toEqual([winner.version, loser.version]);
		if (loser.state !== "value") throw new Error("the loser can't be read");

		wall = T0 + 2000;
		await b.store.put("notes", "x", loser.value);
		await syncAll([a, b]);
		expect(value(a.store, "notes", "x")).toBe(loser.value as string);
	});
});

describe("records that aren't the network's are refused", () => {
	async function fromB(): Promise<{ a: Computer; b: Computer; record: WireRecord }> {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await b.store.put("notes", "x", "real");
		const [record] = await ownRecords(b.store, "notes");
		return { a, b, record };
	}

	test("a record signed by another key than its author's", async () => {
		const { a, b, record } = await fromB();
		const mallory = createTlsIdentity();
		const forged = signRecord({ ...headerOf(record), counter: 1 }, Buffer.from(record.body, "base64"), crypto.createPrivateKey(mallory.key));
		expect(forged.author).toBe(b.id);
		const result = await a.store.apply([forged]);
		expect(result.refused.map((r) => r.reason)).toEqual(["bad-signature"]);
		expect(a.store.get("notes", "x")).toBeNull();
		expect(a.store.heldCount).toBe(0);
	});

	test("a record whose body, or any signed field, was changed on the way", async () => {
		const { a, record } = await fromB();
		const body = Buffer.from(record.body, "base64");
		body[body.length - 1] ^= 1;
		const tampered = [
			{ ...record, body: body.toString("base64") },
			{ ...record, id: "y" },
			{ ...record, wall: record.wall + 1 },
			{ ...record, deleted: true, body: "" },
			{ ...record, epoch: 1 },
		];
		const result = await a.store.apply(tampered);
		expect(result.refused.map((r) => r.reason)).toEqual(["bad-signature", "bad-signature", "bad-signature", "bad-signature", "bad-signature"]);
		expect(a.store.list("notes")).toEqual([]);
		// and the real one still goes through
		expect((await a.store.apply([record])).accepted).toBe(1);
	});

	test("a malformed record names what is wrong with it", async () => {
		const { a, record } = await fromB();
		const result = await a.store.apply([
			null,
			{ ...record, v: 2 },
			{ ...record, author: "b" },
			// the certificate's SHA-256 fingerprint is no member id
			{ ...record, author: crypto.createHash("sha256").update(record.author).digest("hex") },
			{ ...record, space: "@other" },
			{ ...record, space: "@roster" },
			{ ...record, sig: "!!" },
		]);
		expect(result.refused.map((r) => r.reason)).toEqual(Array(7).fill("malformed"));
		expect(result.refused[1].message).toContain("Unknown record version");
		expect(result.refused[4].message).toContain("Unknown reserved space");
		expect(result.refused[5].message).toContain("must be a member id");
	});

	test("the certificate handed back for an author must hold the key the author's id names", async () => {
		const { a, b, record } = await fromB();
		a.roster.certs.set(b.id, createTlsIdentity().cert);
		await expect(a.store.apply([record])).rejects.toThrow(`The roster's certificate for ${b.id} is another computer's`);
		expect(a.store.get("notes", "x")).toBeNull();
		a.roster.know(b);
		expect((await a.store.apply([record])).accepted).toBe(1);
	});

	test("only the roster's own space and ordinary ones are written through the store; its key records are its own", async () => {
		const [a] = await network("a");
		wall = T0 + 1000;
		await expect(a.store.put(KEYS_SPACE, keysRecordId(a.id, a.id), 1)).rejects.toThrow("belongs to the record store itself");
		await expect(a.store.put("@other", "x", 1)).rejects.toThrow("belongs to the record store itself");
		// a roster record is named by the member it is about, here as on every other computer
		await expect(a.store.put("@roster", "not-a-member", 1)).rejects.toThrow("must be a member id");
		expect(a.store.get("@roster", "not-a-member")).toBeNull();
		await a.store.put("@roster", a.id, { name: "A" });
		expect(value(a.store, "@roster", a.id)).toEqual({ name: "A" });
	});

	test("a record from a computer that isn't a member waits, and is admitted once it is one", async () => {
		const { a, b, record } = await fromB();
		a.roster.certs.delete(b.id);
		const result = await a.store.apply([record]);
		expect(result.held).toBe(1);
		expect(a.store.get("notes", "x")).toBeNull();
		// held records are not passed on
		expect((await a.store.changes(null, 100)).records.some((r) => r.space === "notes")).toBe(false);
		// still held after a restart
		a.reopen();
		expect(a.store.heldCount).toBe(1);
		expect((await a.store.readmit()).held).toBe(1);

		a.roster.know(b);
		const readmitted = await a.store.readmit();
		expect(readmitted.accepted).toBe(1);
		expect(a.store.heldCount).toBe(0);
		expect(value(a.store, "notes", "x")).toBe("real");
	});

	test("a member the roster removes loses what it wrote after, on every computer, whichever came first", async () => {
		const [a, b, c] = await network("a", "b", "c");
		wall = T0 + 1000;
		await a.store.put("notes", "x", "a, before");
		await syncAll([a, b, c]);
		wall = T0 + 3000;
		await c.store.put("notes", "x", "c, after its removal");
		// b hears of the write before the removal, a after it
		await b.store.pull("c", c.store);
		for (const comp of [a, b]) comp.roster.removedFrom.set(c.id, T0 + 2000);
		await a.store.pull("c", c.store);
		expect(value(a.store, "notes", "x")).toBe("a, before");
		expect(value(b.store, "notes", "x")).toBe("c, after its removal");
		await b.store.readmit();
		expect(value(b.store, "notes", "x")).toBe("a, before");
		await syncAll([a, b]);
		expect(snapshot(a.store, "notes", ["x"])).toEqual(snapshot(b.store, "notes", ["x"]));
	});

	test("a clock more than a minute ahead is held until it is no longer ahead, and doesn't pull this computer's clock along", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		b.offset = FUTURE_TOLERANCE_MS;
		await b.store.put("notes", "edge", "just inside");
		b.offset = FUTURE_TOLERANCE_MS + 1;
		await b.store.put("notes", "far", "just outside");
		const result = await a.store.pull("b", b.store);
		expect(result.accepted).toBe(1);
		expect(result.held).toBe(1);
		expect(value(a.store, "notes", "edge")).toBe("just inside");
		expect(a.store.get("notes", "far")).toBeNull();

		// a's own write now beats b's far-ahead one once it's admitted: its clock wasn't moved to it
		await a.store.put("notes", "mine", 1);
		const mine = a.store.get("notes", "mine")!;
		expect(mine.wall).toBeLessThan(T0 + 1000 + FUTURE_TOLERANCE_MS + 1);

		expect((await a.store.readmit()).held).toBe(1);
		wall += 1;
		expect((await a.store.readmit()).accepted).toBe(1);
		expect(value(a.store, "notes", "far")).toBe("just outside");
	});

	test("this computer can't write once the network no longer admits it", async () => {
		const [a] = await network("a", "b");
		a.roster.certs.delete(a.id);
		await expect(a.store.put("notes", "x", 1)).rejects.toThrow("the network doesn't admit it");
		expect(a.store.get("notes", "x")).toBeNull();
	});
});

// a, about to be removed from T0 + 5000, wrote Y while still a member and
// then X after; every other computer has Y and has pulled past it
async function removal(...names: string[]): Promise<{ a: Computer; rest: Computer[] }> {
	const computers = await network("a", ...names);
	const [a] = computers;
	wall = T0 + 1000;
	await a.store.put("p", "doc", "Y");
	await syncAll(computers);
	wall = T0 + 10_000;
	await a.store.put("p", "doc", "X");
	return { a, rest: computers.slice(1) };
}

async function learnRemoval(c: Computer, removed: Computer): Promise<void> {
	c.roster.removedFrom.set(removed.id, T0 + 5000);
	await c.store.readmit();
}

describe("a removal converges", () => {
	test("whether a computer accepted the removed one's write before or after hearing of the removal", async () => {
		const { a, rest } = await removal("s1", "s2");
		const [s1, s2] = rest;
		await s1.store.pull("a", a.store);
		expect(value(s1.store, "p", "doc")).toBe("X");
		await learnRemoval(s1, a);
		await learnRemoval(s2, a);
		await s2.store.pull("a", a.store);
		await syncAll([a, s1, s2]);
		expect(value(s1.store, "p", "doc")).toBe("Y");
		expect(value(s2.store, "p", "doc")).toBe("Y");
	});

	test("with the removed computer gone, the others give back what it replaced", async () => {
		const { a, rest } = await removal("s1", "s2");
		const [s1, s2] = rest;
		await s1.store.pull("a", a.store);
		await learnRemoval(s1, a);
		await learnRemoval(s2, a);
		await s2.store.pull("a", a.store);
		// a is never reached again, and s1 restarts first
		s1.reopen();
		await syncAll([s1, s2]);
		expect(snapshot(s1.store, "p", ["doc"])).toEqual(snapshot(s2.store, "p", ["doc"]));
		expect(value(s1.store, "p", "doc")).toBe("Y");
	});

	test("when every computer accepted the write before hearing of the removal, all agree it is gone", async () => {
		const { a, rest } = await removal("s1", "s2", "s3");
		for (const c of rest) await c.store.pull("a", a.store);
		for (const c of rest) await learnRemoval(c, a);
		await syncAll(rest);
		for (const c of rest) expect(c.store.versions("p", "doc")).toEqual([]);
	});

	test("four computers hearing the write and the removal in any order, from each other, agree", async () => {
		for (let seed = 1; seed <= 12; seed++) {
			const next = random(seed);
			const { a, rest } = await removal("s1", "s2", "s3", "s4");
			const steps = shuffle(
				rest.flatMap((c) => [{ c, learn: true }, { c, learn: false }, { c, learn: false }]),
				next,
			);
			let someoneKeptY = false;
			for (const { c, learn } of steps) {
				if (learn && !c.roster.removedFrom.has(a.id)) {
					// X can never come in after this, so whoever still has Y keeps it
					if (value(c.store, "p", "doc") === "Y") someoneKeptY = true;
					await learnRemoval(c, a);
				} else if (!learn) {
					const from = [a, ...rest][Math.floor(next() * (rest.length + 1))];
					if (from !== c) await c.store.pull(from.name, from.store);
				}
			}
			await syncAll(rest);
			const expected = snapshot(rest[0].store, "p", ["doc"]);
			for (const c of rest) expect(snapshot(c.store, "p", ["doc"])).toEqual(expected);
			expect(value(rest[0].store, "p", "doc")).toBe(someoneKeptY ? "Y" : null);
		}
	});

	test("a version pushed out by the MAX_VERSIONS bound comes back when one that outranked it is refused", async () => {
		wall = T0;
		const roster = new Roster();
		const s1 = computer("s1", roster);
		const s2 = computer("s2", new Roster());
		const writers = Array.from({ length: MAX_VERSIONS + 1 }, (_, i) => computer(`w${i}`, roster));
		const all = [s1, s2, ...writers];
		roster.know(...all);
		s2.roster.know(...all);
		await s1.store.createEpoch(all.map((c) => c.identity.cert));
		for (const c of [s2, ...writers]) await c.store.pull("s1", s1.store);

		const [oldest, ...newer] = writers;
		const refused = newer[newer.length - 1];
		wall = T0 + 1000;
		await oldest.store.put("p", "doc", "oldest");
		for (const [i, w] of newer.entries()) {
			wall = T0 + 2000 + i;
			await w.store.put("p", "doc", w.name);
		}
		// s1 takes the oldest through s2, so its cursor on s2 is past it, then
		// the sixteen newer ones push it out
		await s2.store.pull(oldest.name, oldest.store);
		await s1.store.pull("s2", s2.store);
		expect(s1.store.versions("p", "doc").map((v) => v.author)).toContain(oldest.id);
		for (const w of newer) await s1.store.pull(w.name, w.store);
		expect(s1.store.versions("p", "doc").map((v) => v.author)).not.toContain(oldest.id);

		const removeRefused = async (c: Computer) => {
			c.roster.removedFrom.set(refused.id, T0 + 1500);
			await c.store.readmit();
		};
		await removeRefused(s1);
		await removeRefused(s2);
		for (const w of writers) await s2.store.pull(w.name, w.store);
		await syncAll([s1, s2]);
		expect(snapshot(s1.store, "p", ["doc"])).toEqual(snapshot(s2.store, "p", ["doc"]));
		expect(s1.store.versions("p", "doc").map((v) => v.author)).toContain(oldest.id);
	});

	test("a pull that was running when readmit() forgot the cursors starts over instead of saving its old one", async () => {
		const { a, rest } = await removal("s1", "s2");
		const [s1, s2] = rest;
		await s1.store.pull("a", a.store);
		await learnRemoval(s2, a);
		// s1 asks s2 for what is past its cursor (nothing), and readmit() runs before the answer lands
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const slow: RecordSource = {
			async changes(cursor, limit) {
				const batch = await s2.store.changes(cursor, limit);
				if (calls++ === 0) await gate;
				return batch;
			},
		};
		const pulling = s1.store.pull("s2", slow);
		await learnRemoval(s1, a);
		release();
		await pulling;
		expect(value(s1.store, "p", "doc")).toBe("Y");
	});
});

describe("a full held list", () => {
	test("fails the pull loudly and keeps its cursor before what it couldn't keep", async () => {
		const [a, b] = await network("a", "b");
		// a flood from computers nobody knows yet: held unread, so a made-up signature gets it in
		const strangers = Array.from({ length: 4 }, () => createTlsIdentity());
		const flood = Array.from({ length: MAX_HELD }, (_, i) => ({
			v: 1,
			space: "flood",
			id: `r${i}`,
			wall: T0,
			counter: 0,
			author: memberIdOf(strangers[i % strangers.length].cert),
			deleted: true,
			epoch: 0,
			key: "0000000000000000",
			body: "",
			sig: Buffer.alloc(64).toString("base64"),
		}));
		expect((await a.store.apply(flood)).held).toBe(MAX_HELD);

		wall = T0 + 1000;
		a.roster.certs.delete(b.id);
		await b.store.put("notes", "x", "kept later");
		await expect(a.store.pull("b", b.store)).rejects.toThrow(`1 records from b weren't kept: ${MAX_HELD} records already wait to be admitted`);
		await expect(a.store.pull("b", b.store)).rejects.toThrow("weren't kept");

		// once the strangers are known their forgeries are refused, held drains, and the pull takes what it skipped
		a.roster.know(b);
		for (const s of strangers) a.roster.certs.set(memberIdOf(s.cert), s.cert);
		expect((await a.store.readmit()).refused.length).toBe(MAX_HELD);
		expect(a.store.heldCount).toBe(0);
		expect((await a.store.pull("b", b.store)).accepted).toBe(1);
		expect(value(a.store, "notes", "x")).toBe("kept later");
	});
});

// A relay as dumb as one can be: it keeps what it is handed, in order, and
// lists it after a cursor. No keys, no checks, nothing of Paperboard but
// the shapes of what it carries.
class DumbRelay {
	readonly log: string = "relay-log";
	readonly kept: string[] = [];
	append(records: WireRecord[]): string {
		for (const r of records) this.kept.push(JSON.stringify(r));
		return this.log;
	}
	changes(cursor: ChangeCursor | null, limit: number): ChangeBatch {
		const after = cursor?.log === this.log ? cursor.after : 0;
		const records = this.kept.slice(after, after + limit).map((line) => JSON.parse(line) as WireRecord);
		return { log: this.log, records, next: after + records.length, more: after + records.length < this.kept.length };
	}
}

describe("a dumb relay", () => {
	test("makes two computers that never talk converge, keys included, and never sees plaintext", async () => {
		wall = T0;
		const roster = new Roster();
		const a = computer("a", roster);
		const b = computer("b", roster);
		roster.know(a, b);
		const relay = new DumbRelay();
		const changed: string[][] = [];
		b.store.watch("notes", (ids) => changed.push(ids));

		await a.store.createEpoch([a.identity.cert, b.identity.cert]);
		wall = T0 + 1000;
		await a.store.put("notes", "secret", "the secret is pancakes");
		await a.store.push("relay", relay);
		await b.store.pull("relay", relay);
		expect(value(b.store, "notes", "secret")).toBe("the secret is pancakes");
		expect(changed.flat()).toContain("secret");

		wall = T0 + 2000;
		await b.store.put("notes", "secret", "the secret is waffles");
		await b.store.put("notes", "other", { from: "b", pancakes: false });
		await b.store.push("relay", relay);
		await a.store.pull("relay", relay);
		// a passes on what it took (any store can be the only path between
		// two others), and after that nothing moves twice
		expect(await a.store.push("relay", relay)).toBe(2);
		expect(await a.store.push("relay", relay)).toBe(0);
		const echoed = await b.store.pull("relay", relay);
		expect(echoed.accepted).toBe(0);
		expect(echoed.known).toBeGreaterThan(0);
		expect(snapshot(a.store, "notes", ["secret", "other"])).toEqual(snapshot(b.store, "notes", ["secret", "other"]));
		expect(value(a.store, "notes", "secret")).toBe("the secret is waffles");

		for (const line of relay.kept) {
			expect(line).not.toContain("pancakes");
			expect(line).not.toContain("waffles");
			const r = JSON.parse(line) as WireRecord;
			expect(Buffer.from(r.body, "base64").includes(Buffer.from("pancakes"))).toBe(false);
		}
	});

	test("a malformed or stuck answer fails the pull and saves no cursor", async () => {
		const [a] = await network("a");
		const malformed: RecordSource = { changes: () => ({ log: "x", records: [], next: -1, more: false }) };
		await expect(a.store.pull("malformed", malformed)).rejects.toThrow("malformed change batch");
		const stuck: RecordSource = { changes: () => ({ log: "x", records: [], next: 0, more: true }) };
		await expect(a.store.pull("stuck", stuck)).rejects.toThrow("gave none past 0");
		a.reopen();
		await expect(a.store.changes({ log: "x", after: -1 }, 10)).rejects.toThrow("Invalid change cursor");
	});

	test("a cursor from another log starts over, so a relay that was wiped gets everything again", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await a.store.put("notes", "x", 1);
		const first = new DumbRelay();
		await a.store.push("relay", first);
		const wiped = new (class extends DumbRelay {
			readonly log = "a-new-log";
		})();
		await a.store.push("relay", wiped);
		expect(wiped.kept.length).toBe(first.kept.length);
		await b.store.pull("relay", wiped);
		expect(value(b.store, "notes", "x")).toBe(1);
	});
});

describe("network keys", () => {
	test("a record under an old epoch still reads after the epoch advances, and a removed computer can't read what comes after", async () => {
		const [a, b, c] = await network("a", "b", "c");
		wall = T0 + 1000;
		await a.store.put("notes", "old", "epoch 0");
		await syncAll([a, b, c]);

		// c is left out of epoch 1
		wall = T0 + 2000;
		const epoch1 = await a.store.createEpoch([a.identity.cert, b.identity.cert]);
		expect(epoch1.epoch).toBe(1);
		await syncAll([a, b, c]);
		expect(b.store.networkKeys().current).toEqual(epoch1);
		expect(c.store.networkKeys().current?.epoch).toBe(0);

		wall = T0 + 3000;
		await b.store.put("notes", "new", "epoch 1");
		await syncAll([a, b, c]);
		expect(b.store.get("notes", "new")?.epoch).toBe(1);
		for (const comp of [a, b]) {
			expect(value(comp.store, "notes", "old")).toBe("epoch 0");
			expect(value(comp.store, "notes", "new")).toBe("epoch 1");
		}
		expect(value(c.store, "notes", "old")).toBe("epoch 0");
		const locked = c.store.get("notes", "new");
		expect(locked?.state).toBe("unreadable");

		// and after a restart, the keys come back from the records alone
		b.reopen();
		expect(value(b.store, "notes", "old")).toBe("epoch 0");
		expect(b.store.networkKeys().keys.map((k) => k.epoch)).toEqual([0, 1]);
	});

	test("a computer that joins later is given every epoch's key and reads all of it", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await a.store.put("notes", "x", "epoch 0");
		await a.store.createEpoch([a.identity.cert, b.identity.cert]);
		await a.store.put("notes", "y", "epoch 1");
		const d = computer("d", new Roster());
		for (const comp of [a, b, d]) comp.roster.know(a, b, d);
		const changed: string[][] = [];
		d.store.watch("notes", (ids) => changed.push(ids));

		await syncAll([a, b]);
		await d.store.pull("a", a.store);
		expect(d.store.get("notes", "x")?.state).toBe("unreadable");
		expect(d.store.get("notes", "y")?.state).toBe("unreadable");
		await b.store.shareKeys([d.identity.cert]);
		await d.store.pull("b", b.store);
		expect(value(d.store, "notes", "x")).toBe("epoch 0");
		expect(value(d.store, "notes", "y")).toBe("epoch 1");
		// the records it couldn't read are announced again when the keys arrive
		expect(changed.at(-1)).toEqual(expect.arrayContaining(["x", "y"]));
	});

	test("two computers starting the same epoch apart keep both keys readable and settle on one to write with", async () => {
		const [a, b] = await network("a", "b");
		const certs = [a.identity.cert, b.identity.cert];
		wall = T0 + 1000;
		const fromA = await a.store.createEpoch(certs);
		const fromB = await b.store.createEpoch(certs);
		expect(fromA.epoch).toBe(fromB.epoch);
		await a.store.put("notes", "a", "under a's key");
		await b.store.put("notes", "b", "under b's key");
		await syncAll([a, b]);
		for (const comp of [a, b]) {
			expect(value(comp.store, "notes", "a")).toBe("under a's key");
			expect(value(comp.store, "notes", "b")).toBe("under b's key");
		}
		const settled = [fromA, fromB].sort((p, q) => (p.id < q.id ? -1 : 1))[0];
		expect(a.store.networkKeys().current).toEqual(settled);
		expect(b.store.networkKeys().current).toEqual(settled);
	});

	test("a key record can't carry a key for a later epoch than its header says, which is what the roster judged", async () => {
		const [a, b] = await network("a", "b");
		const header: RecordHeader = { space: KEYS_SPACE, id: keysRecordId(a.id, b.id), wall: T0 + 1000, counter: 0, author: b.id, deleted: false, epoch: 0, key: "" };
		const sneaky = signRecord(header, wrapKeys(header, a.identity.cert, [newNetworkKey(5)]), crypto.createPrivateKey(b.identity.key));
		expect((await a.store.apply([sneaky])).accepted).toBe(1);
		const keys = a.store.networkKeys();
		expect(keys.current?.epoch).toBe(0);
		expect(keys.problems).toEqual([expect.stringContaining("a key for epoch 5 under a header for epoch 0")]);
	});

	test("a computer without a key can't write, and a new epoch must include this computer", async () => {
		wall = T0;
		const lone = computer("lone");
		lone.roster.know(lone);
		await expect(lone.store.put("notes", "x", 1)).rejects.toThrow("no network key");
		const other = createTlsIdentity();
		await expect(lone.store.createEpoch([other.cert])).rejects.toThrow("must include this computer");
		await expect(lone.store.shareKeys([other.cert])).rejects.toThrow("no network keys to share");
	});
});

describe("on disk", () => {
	test("a write a crash cut short leaves the old state, and its temp file is swept", async () => {
		const [a] = await network("a", "b");
		wall = T0 + 1000;
		await a.store.put("notes", "x", "saved");
		const temp = `${bucketFile(a.dir, "notes", "x")}.0123456789ab.tmp`;
		fs.writeFileSync(temp, '{"records": [ half');
		a.reopen();
		expect(value(a.store, "notes", "x")).toBe("saved");
		expect(fs.existsSync(temp)).toBe(false);
	});

	test("a crash between the two files of a move leaves the record once", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await b.store.put("notes", "x", "moved");
		a.roster.certs.delete(b.id);
		await a.store.pull("b", b.store);
		const heldFile = path.join(a.dir, "held.json");
		const heldBefore = fs.readFileSync(heldFile, "utf8");
		a.roster.know(b);
		await a.store.readmit();
		// as if the crash came after the space was saved, before held was
		fs.writeFileSync(heldFile, heldBefore);
		a.reopen();
		expect(a.store.heldCount).toBe(0);
		expect(value(a.store, "notes", "x")).toBe("moved");
	});

	test("a failure halfway through a change leaves nothing of it, in memory or on disk", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await b.store.put("notes", "x", 1);
		await b.store.put("notes", "y", 2);
		const records = await ownRecords(b.store, "notes");
		const admits = a.roster.admits.bind(a.roster);
		a.roster.admits = (h) => {
			if (h.id === "y") throw new Error("the roster broke");
			return admits(h);
		};
		await expect(a.store.apply(records)).rejects.toThrow("the roster broke");
		expect(a.store.get("notes", "x")).toBeNull();
		a.reopen();
		expect(a.store.get("notes", "x")).toBeNull();
		a.roster.admits = admits;
		expect((await a.store.apply(records)).accepted).toBe(2);
	});

	test("sequence numbers are never handed out twice, even when the newest record leaves", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await a.store.put("notes", "x", 1);
		await b.store.pull("a", a.store);
		// x, the newest record a has, goes back to held
		a.roster.removedFrom.set(a.id, T0 + 500);
		await a.store.readmit();
		a.roster.removedFrom.delete(a.id);
		a.reopen();
		wall = T0 + 2000;
		await a.store.put("notes", "y", 2);
		await b.store.pull("a", a.store);
		expect(value(b.store, "notes", "y")).toBe(2);
	});

	test("a damaged file stops the store from opening and is left as it was", () => {
		wall = T0;
		const a = computer("a");
		for (const file of [...["meta.json", "held.json", "cursors.json"].map((name) => path.join(a.dir, name)), bucketFile(a.dir, "notes", "x")]) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
			fs.writeFileSync(file, '{"records": [ {"seq": 1, "rec');
			expect(() => a.reopen()).toThrow(RecordStoreCorruptError);
			expect(fs.readFileSync(file, "utf8")).toBe('{"records": [ {"seq": 1, "rec');
			if (before) fs.writeFileSync(file, before);
			else fs.rmSync(file);
		}
		// a record that parses but isn't one is damage too
		fs.writeFileSync(path.join(a.dir, "held.json"), JSON.stringify({ records: [{ v: 1 }] }));
		expect(() => a.reopen()).toThrow(RecordStoreCorruptError);
	});

	test("a put rewrites only its own bucket of the space", async () => {
		const [a] = await network("a");
		wall = T0 + 1000;
		const ids = idsInDistinctBuckets(3);
		for (const id of ids) await a.store.put("notes", id, `first ${id}`);
		const before = ids.map((id) => fs.readFileSync(bucketFile(a.dir, "notes", id), "utf8"));
		await a.store.put("notes", ids[1], "second");
		const after = ids.map((id) => fs.readFileSync(bucketFile(a.dir, "notes", id), "utf8"));
		expect(after[0]).toBe(before[0]);
		expect(after[2]).toBe(before[2]);
		expect(after[1]).not.toBe(before[1]);
		expect(fs.readdirSync(path.dirname(bucketFile(a.dir, "notes", ids[0]))).length).toBe(3);
		expect(SPACE_BUCKETS).toBe(256);
		a.reopen();
		expect(ids.map((id) => value(a.store, "notes", id))).toEqual([`first ${ids[0]}`, "second", `first ${ids[2]}`]);
	});

	// Inventory: Data loss — a restart rewrites nothing: the first change after it writes its own record's bucket alone, so a folder that can't be written stops nothing it didn't touch.
	test("after a restart, a change writes only its own record's bucket, and watchers still hear of records a newly arrived key made readable", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		const ids = idsInDistinctBuckets(3);
		for (const id of ids) await a.store.put("notes", id, `first ${id}`);
		// every start rebuilds the keyring: each key "arrives" again
		a.reopen();
		const inode = (id: string) => fs.statSync(bucketFile(a.dir, "notes", id)).ino;
		const before = ids.map(inode);
		await a.store.put("notes", ids[1], "second");
		const after = ids.map(inode);
		expect(after[0]).toBe(before[0]);
		expect(after[2]).toBe(before[2]);
		expect(after[1]).not.toBe(before[1]);

		// b writes under a new key whose share reaches a after the record does
		await b.store.createEpoch([b.identity.cert, a.identity.cert]);
		wall += 1000;
		await b.store.put("plans", "trip", "by train");
		await a.store.apply(await ownRecords(b.store, "plans"));
		expect(a.store.get("plans", "trip")?.state).toBe("unreadable");
		const heard: string[][] = [];
		a.store.watch("plans", (changed) => heard.push(changed));
		const planBucket = () => fs.statSync(bucketFile(a.dir, "plans", "trip")).ino;
		const planBefore = planBucket();
		await a.store.apply(await ownRecords(b.store, KEYS_SPACE));
		expect(a.store.get("plans", "trip")?.state).toBe("value");
		expect(heard).toContainEqual(["trip"]);
		// readable now, and its file stays as it was
		expect(planBucket()).toBe(planBefore);
	});

	test("a bucket a readmit empties is removed, and a crash before its removal leaves the record once", async () => {
		const [a, b] = await network("a", "b");
		wall = T0 + 1000;
		await b.store.put("notes", "x", "theirs");
		await a.store.pull("b", b.store);
		const bucket = bucketFile(a.dir, "notes", "x");
		const kept = fs.readFileSync(bucket, "utf8");
		a.roster.removedFrom.set(b.id, T0 + 500);
		await a.store.readmit();
		expect(fs.existsSync(bucket)).toBe(false);
		expect(a.store.heldCount).toBe(1);
		// as if the crash came after held was saved, before the bucket went
		fs.writeFileSync(bucket, kept);
		a.reopen();
		expect(a.store.heldCount).toBe(0);
		expect(value(a.store, "notes", "x")).toBe("theirs");
		// the next readmit holds it again, and every start asks once (rosterStore.ts)
		await a.store.readmit();
		expect(a.store.heldCount).toBe(1);
		a.reopen();
		expect(a.store.heldCount).toBe(1);
		expect(a.store.get("notes", "x")).toBeNull();
	});

	test("a record in another bucket or space than its own, or a file that isn't a bucket, is damage", async () => {
		const [a] = await network("a");
		wall = T0 + 1000;
		const [x, y] = idsInDistinctBuckets(2);
		await a.store.put("notes", x, 1);
		const right = bucketFile(a.dir, "notes", x);
		const wrong = bucketFile(a.dir, "notes", y);
		fs.renameSync(right, wrong);
		expect(() => a.reopen()).toThrow(`which belongs in bucket`);
		fs.renameSync(wrong, right);
		const elsewhere = bucketFile(a.dir, "other", x);
		fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
		fs.copyFileSync(right, elsewhere);
		expect(() => a.reopen()).toThrow(`it holds a record of notes`);
		fs.rmSync(path.dirname(elsewhere), { recursive: true });
		for (const stray of [path.join(path.dirname(right), "notes.json"), path.join(a.dir, "spaces", `${Buffer.from("notes").toString("hex")}.json`)]) {
			fs.writeFileSync(stray, '{"records": []}');
			expect(() => a.reopen()).toThrow(RecordStoreCorruptError);
			fs.rmSync(stray);
		}
		a.reopen();
		expect(value(a.store, "notes", x)).toBe(1);
	});

	test("a store is one key's: opened with another, it refuses and changes nothing", async () => {
		const [a] = await network("a");
		const files = () => fs.readdirSync(a.dir, { recursive: true }).map(String).sort().map((f) => [f, fs.statSync(path.join(a.dir, f)).isFile() ? fs.readFileSync(path.join(a.dir, f), "utf8") : null]);
		const before = files();
		const stranger = createTlsIdentity();
		expect(() => RecordStore.open({ dir: a.dir, identity: stranger, membership: a.roster })).toThrow(RecordStoreOwnerError);
		expect(() => RecordStore.open({ dir: a.dir, identity: stranger, membership: a.roster })).toThrow(`belongs to computer ${a.id}`);
		expect(files()).toEqual(before);
		a.reopen();
		expect(a.store.networkKeys().current?.epoch).toBe(0);
	});
});

describe("the record format", () => {
	test("is the bytes written down in record.ts", async () => {
		const [a] = await network("a");
		wall = T0 + 1000;
		await a.store.put("notes", "x", 1);
		const [r] = await ownRecords(a.store, "notes");
		expect(parseWireRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
		const str = (s: string) => {
			const b = Buffer.from(s);
			return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]);
		};
		const u = (n: number, bytes: number) => {
			const b = Buffer.alloc(bytes);
			b.writeUIntBE(n, bytes - Math.min(bytes, 6), Math.min(bytes, 6));
			return b;
		};
		const body = Buffer.from(r.body, "base64");
		const signed = Buffer.concat([
			Buffer.from("PBR1"),
			str(r.space),
			str(r.id),
			u(r.wall, 8),
			u(r.counter, 4),
			str(r.author),
			Buffer.from([0]),
			u(r.epoch, 4),
			str(r.key),
			u(body.length, 4),
			body,
		]);
		const publicKey = new crypto.X509Certificate(a.identity.cert).publicKey;
		// the author is the first 20 bytes of SHA-256 over the public key's SubjectPublicKeyInfo DER, in lowercase hex
		expect(r.author).toBe(crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest().subarray(0, 20).toString("hex"));
		expect(crypto.verify("sha256", signed, { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(r.sig, "base64"))).toBe(true);
		expect(recordDigest(r)).toBe(crypto.createHash("sha256").update(signed).digest("hex"));
		// WebCrypto, which a non-Node client would use, checks it too
		const spki = publicKey.export({ type: "spki", format: "der" });
		const imported = await crypto.webcrypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
		expect(await crypto.webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, imported, Buffer.from(r.sig, "base64"), signed)).toBe(true);
	});
});
