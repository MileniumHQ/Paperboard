import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import type * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { WebSocketServer } from "ws";
import { LINK_PATH, NetworkLinks, type LinkTiming, type NetworkStatus, type PeerStatus } from "../src/network/links";
import { memberIdOf } from "../src/network/memberId";
import { Roster } from "../src/network/roster";
import { NETWORK_DIR, RosterRecords } from "../src/network/rosterStore";
import type { RecordStore } from "../src/network/store";
import { closeTlsListener, createTlsListener, type TlsListener } from "../src/server/tlsListener";
import { createTlsIdentity, loadOrCreateTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";
import { standInForJoining } from "./support/standInForJoining";
import { tempDir } from "testkit/fs";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// Short timings so a whole run of dials, pings and takeovers fits in a test;
// every wait below waits for what the network reports, never for a time.
const FAST: Partial<LinkTiming> = {
	pingMs: 200,
	requestTimeoutMs: 600,
	connectTimeoutMs: 2_000,
	backoffMinMs: 20,
	backoffMaxMs: 200,
	takeoverMs: 400,
	noticeDebounceMs: 10,
};

// A computer of the network: what the daemon wires for it (roster, record
// store, links) behind the daemon's own TLS listener, in a folder of its own.
interface Node {
	name: string;
	dir: string;
	identity: TlsIdentity;
	id: string;
	listening: boolean;
	port: number | null;
	roster: Roster;
	records: RecordStore;
	links: NetworkLinks;
	/** upgrades its listener took on /network */
	upgrades: number;
	start(): void;
	stop(): Promise<void>;
	restart(): Promise<void>;
}

const nodes: Node[] = [];
const servers: TlsListener[] = [];
afterEach(async () => {
	for (const node of nodes.splice(0)) await node.stop();
	for (const listener of servers.splice(0)) closeTlsListener(listener);
});

function listen(listener: TlsListener, port = 0): Promise<number> {
	return new Promise((resolve, reject) => {
		listener.server.once("error", reject);
		listener.server.listen(port, "127.0.0.1", () => resolve((listener.server.address() as net.AddressInfo).port));
	});
}

async function node(name: string, options: { listening?: boolean; timing?: Partial<LinkTiming> } = {}): Promise<Node> {
	const dir = tempDir(`pb-link-${name}-`);
	const identity = loadOrCreateTlsIdentity(dir);
	const listening = options.listening ?? true;
	let listener: TlsListener | null = null;
	let stopped = true;
	const n = {
		name,
		dir,
		identity,
		id: memberIdOf(identity.cert),
		listening,
		port: null,
		upgrades: 0,
		async open() {
			const members = await RosterRecords.open(path.join(dir, NETWORK_DIR), identity);
			n.roster = await Roster.open(dir, identity, members);
			n.records = members.records;
			n.links = new NetworkLinks({ identity, roster: n.roster, store: n.records, listening, timing: { ...FAST, ...options.timing } });
			if (listening) {
				listener = createTlsListener(identity, (_req, res) => {
					res.statusCode = 404;
					res.end();
				});
				listener.http.on("upgrade", (req: http.IncomingMessage, socket, head) => {
					if (req.url !== LINK_PATH) {
						socket.destroy();
						return;
					}
					n.upgrades++;
					n.links.accept(req, socket, head);
				});
				n.port = await listen(listener, n.port ?? 0);
			}
			stopped = false;
		},
		start() {
			n.links.start();
		},
		async stop() {
			if (stopped) return;
			stopped = true;
			await n.links.stop();
			n.roster.close();
			if (listener) {
				const closed = new Promise<void>((resolve) => listener!.server.once("close", () => resolve()));
				closeTlsListener(listener);
				await closed;
			}
		},
		async restart() {
			await n.stop();
			await n.open();
			n.start();
		},
	} as Node & { open(): Promise<void> };
	await n.open();
	nodes.push(n);
	return n;
}

const dialOf = (n: Node) => (n.port === null ? undefined : { host: "127.0.0.1", port: n.port });

/** members of each other (see standInForJoining), each dialed where it listens unless `addresses` is false */
async function members(list: Node[], addresses = true): Promise<void> {
	await standInForJoining(list.map((n) => ({ records: n.records, cert: n.identity.cert, dial: addresses ? dialOf(n) : undefined })));
}

const peer = (from: Node, to: Node): PeerStatus => {
	const found = from.links.status().peers.find((p) => p.id === to.id);
	if (!found) throw new Error(`${from.name} doesn't list ${to.name}`);
	return found;
};
const note = (n: Node, id: string) => {
	const record = n.records.get("notes", id);
	return record?.state === "value" ? record.value : undefined;
};
const notesOf = (n: Node) => n.records.list("notes").map((r) => r.id);
const linked = (a: Node, b: Node) => peer(a, b).reach.state === "linked" && peer(b, a).reach.state === "linked";
const ordered = (a: Node, b: Node) => (a.id < b.id ? [a, b] : [b, a]);

function permutations<T>(items: T[]): T[][] {
	if (items.length <= 1) return [items];
	return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe("links", () => {
	// Inventory: Core contract — two members link over mutual TLS and end up holding the same records.
	test("two members link, the smaller id dialing, and converge; both report it", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		expect(peer(a, b).sync.state).toBe("never");
		await a.records.put("notes", "from-a", "hello");
		a.start();
		b.start();
		await b.records.put("notes", "from-b", "there");
		await waitFor("both to hold both notes", () => note(a, "from-b") === "there" && note(b, "from-a") === "hello");
		await waitFor("the link to be up both ways", () => linked(a, b));
		const [smaller, larger] = ordered(a, b);
		expect(peer(smaller, larger).reach).toMatchObject({ state: "linked", dialedBy: "this" });
		expect(peer(larger, smaller).reach).toMatchObject({ state: "linked", dialedBy: "peer" });
		for (const [from, to] of [[a, b], [b, a]] as const) {
			const status = peer(from, to);
			expect(status.online).toBe(true);
			await waitFor(`${from.name} to have synced with ${to.name}`, () => peer(from, to).sync.state === "synced");
			expect(peer(from, to).sync.lastFailure).toBeNull();
		}
		// one link each way it could have been made: the larger waited
		expect(a.upgrades + b.upgrades).toBe(1);
	});

	// Inventory: Core contract — records reach every member through whichever links exist, in any order they come up.
	test("three members converge in any link order, two of them only ever reaching the third", async () => {
		for (const order of permutations([0, 1, 2])) {
			// a and c accept no links: each reaches b alone, and everything between them goes through b
			const [a, b, c] = [await node("a", { listening: false }), await node("b"), await node("c", { listening: false })];
			const all = [a, b, c];
			await members(all);
			for (const n of all) await n.records.put("notes", n.name, `${n.name} in order ${order.join("")}`);
			for (const i of order) all[i].start();
			await waitFor(`every note everywhere (order ${order.join("")})`, () => all.every((n) => notesOf(n).join() === "a,b,c"));
			expect(note(c, "a")).toBe(`a in order ${order.join("")}`);
			// a and c can't reach each other, and say why; each never synced with the other, though it holds what the other wrote
			for (const [from, to] of [[a, c], [c, a]] as const) {
				expect(peer(from, to)).toMatchObject({ online: false, reach: { state: "unreachable" }, sync: { state: "never" } });
				await waitFor(`${from.name}'s link to b`, () => peer(from, b).reach.state === "linked");
				expect(peer(from, b).reach).toMatchObject({ dialedBy: "this" });
			}
			for (const n of all) await n.stop();
		}
	});

	// Inventory: Security — only a member's key opens a link; any other computer is refused before it is told anything.
	test("a stranger's certificate is refused, and a member's address answered by another computer is never trusted", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		// the stranger thinks a is a member of its network; a has never heard of it
		const stranger = await node("stranger", { listening: false });
		await stranger.records.put("@roster", a.id, { cert: a.identity.cert, dial: dialOf(a), facts: {} });
		a.start();
		stranger.start();
		await waitFor("the stranger to be refused", () => peer(stranger, a).reach.state === "dialing" && /refused the link \(403\)/.test(String((peer(stranger, a).reach as { lastError: string }).lastError)));
		expect(a.links.status().peers.map((p) => p.id)).toEqual([b.id]);
		expect(peer(stranger, a).sync.state).toBe("never");

		// b is told a's address, but another computer listens there
		await a.stop();
		const impostor = await node("impostor");
		await b.records.put("@roster", a.id, { cert: a.identity.cert, dial: dialOf(impostor), facts: {} });
		impostor.start();
		b.start();
		await waitFor("b to refuse what answered at a's address", () => /another computer answered there|certificate/i.test(String((peer(b, a).reach as { lastError?: string }).lastError ?? "")));
		expect(peer(b, a).online).toBe(false);
		expect(impostor.upgrades).toBe(0);
	});

	// Inventory: Security — a computer removed from the roster loses its link at once and can't make another.
	test("a member removed from the roster has its link cut and can't link again", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		a.start();
		b.start();
		await waitFor("a and b to link", () => linked(a, b));
		await a.roster.remove(b.id);
		expect(a.links.status().peers).toEqual([]);
		await waitFor("b to lose its link", () => !peer(b, a).online);
		// b still counts a as a member and keeps trying: a refuses it every time
		await waitFor("b to be refused", () => /refused the link \(403\)/.test(String((peer(b, a).reach as { lastError?: string }).lastError ?? "")));
		await b.records.put("notes", "after", "never reaches a");
		await waitFor("b to try again", () => (peer(b, a).reach as { attempts?: number }).attempts! >= 2);
		expect(note(a, "after")).toBeUndefined();
	});

	test("two links made at once collapse to the one the smaller id dialed, on both sides", async () => {
		// no waiting: both dial the moment they start
		const [a, b] = [await node("a", { timing: { takeoverMs: 0 } }), await node("b", { timing: { takeoverMs: 0 } })];
		await members([a, b]);
		a.start();
		b.start();
		await waitFor("both dials to have been taken", () => a.upgrades + b.upgrades === 2);
		await waitFor("one link both sides agree on", () => linked(a, b));
		const [smaller, larger] = ordered(a, b);
		expect(peer(smaller, larger).reach).toMatchObject({ dialedBy: "this" });
		expect(peer(larger, smaller).reach).toMatchObject({ dialedBy: "peer" });
		// the dropped one was no failure: nobody redials, and the kept link syncs
		await a.records.put("notes", "x", 1);
		await waitFor("the note over the kept link", () => note(b, "x") === 1);
		expect(a.upgrades + b.upgrades).toBe(2);
		expect([peer(a, b), peer(b, a)].map((p) => p.sync.lastFailure)).toEqual([null, null]);
	});

	// Inventory: Data loss — a restart resumes where each side got to: nothing is sent again, and nothing is missed.
	test("a restart resumes from the cursors without sending everything again", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		for (let i = 0; i < 40; i++) await a.records.put("notes", `n${i}`, i);
		a.start();
		b.start();
		await waitFor("b to hold all 40", () => notesOf(b).length === 40);
		await b.restart();
		await a.records.put("notes", "later", "one more");
		await waitFor("the one new note", () => note(b, "later") === "one more");
		await waitFor("b to have pulled from a since its restart", () => peer(b, a).sync.lastPull !== null);
		// only what came after the cursor b kept: the 40 aren't sent again (what
		// came back is at most b's own records, which a passed on after b's last pull)
		const after = peer(b, a).sync.lastPull!;
		expect(after.accepted + after.known).toBeLessThan(40);
		expect(notesOf(b)).toHaveLength(41);
	});

	test("a member that goes offline and comes back catches up, and is reported offline meanwhile", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		a.start();
		b.start();
		await waitFor("a to sync with b", () => linked(a, b) && peer(a, b).sync.state === "synced");
		const before = Date.now();
		await b.stop();
		await waitFor("a to see b go", () => !peer(a, b).online);
		const away = peer(a, b);
		expect(away.lastSeen).toBeGreaterThanOrEqual(before);
		expect(away.sync.state).toBe("synced");
		for (let i = 0; i < 5; i++) await a.records.put("notes", `while-away-${i}`, i);
		await waitFor("a to be trying to reach b", () => peer(a, b).reach.state === "dialing" || peer(a, b).reach.state === "waiting");
		// what b last saw of a survives its restart
		await b.restart();
		await waitFor("b to catch up", () => notesOf(b).length === 5);
		expect(peer(b, a).online).toBe(true);
	});

	test("a daemon nobody can dial (loopback only) dials out and syncs both ways; two such can't, and say why", async () => {
		const desk = await node("desk", { listening: false });
		const rack = await node("rack");
		await members([desk, rack]);
		desk.start();
		rack.start();
		await desk.records.put("notes", "from-desk", 1);
		await rack.records.put("notes", "from-rack", 2);
		await waitFor("both notes both ways", () => note(rack, "from-desk") === 1 && note(desk, "from-rack") === 2);
		// whichever id is smaller, the one that can't be dialed dials
		expect(peer(desk, rack).reach).toMatchObject({ state: "linked", dialedBy: "this" });
		expect(rack.upgrades).toBe(1);

		const [one, two] = [await node("one", { listening: false }), await node("two", { listening: false })];
		await members([one, two]);
		one.start();
		two.start();
		for (const [from, to] of [[one, two], [two, one]] as const) {
			expect(peer(from, to)).toMatchObject({ online: false, lastSeen: null, reach: { state: "unreachable" }, sync: { state: "never", lastSuccessAt: null } });
		}
	});

	test("a peer that answers garbage, or doesn't answer, loses its link and doesn't hold up the others", async () => {
		for (const misbehaves of ["garbage", "stall"] as const) {
			const [a, b] = [await node("a"), await node("b")];
			// a member whose daemon is broken: it takes the link, then talks nonsense or nothing
			const identity = createTlsIdentity();
			const broken = createTlsListener(identity, (_req, res) => res.end());
			servers.push(broken);
			const wss = new WebSocketServer({ noServer: true });
			broken.http.on("upgrade", (req, socket, head) =>
				wss.handleUpgrade(req, socket, head, (ws) => {
					if (misbehaves === "garbage") ws.send("this is not a link message");
					// a stalled daemon reads every request and answers none
				}),
			);
			const port = await listen(broken);
			const id = memberIdOf(identity.cert);
			await members([a, b]);
			await a.records.put("@roster", id, { cert: identity.cert, dial: { host: "127.0.0.1", port }, facts: {} });
			a.start();
			b.start();
			const failed = misbehaves === "garbage" ? /isn't a link message/ : /didn't answer within/;
			await waitFor(`a to drop the ${misbehaves} peer`, () => {
				const bad = a.links.status().peers.find((p) => p.id === id)!;
				return failed.test(`${(bad.reach as { lastError?: string }).lastError ?? ""} ${bad.sync.lastFailure?.error ?? ""}`);
			});
			// meanwhile a and b go on as usual
			await a.records.put("notes", misbehaves, "still syncing");
			await waitFor("b to get a's note", () => note(b, misbehaves) === "still syncing");
			const bad = a.links.status().peers.find((p) => p.id === id)!;
			expect(bad.sync.state).toBe("never");
			expect(peer(a, b).sync.lastFailure).toBeNull();
			for (const n of [a, b]) await n.stop();
			wss.close();
		}
	});

	test("an address a member is seen at is tried at once, and kept only once its key answers there", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b], false);
		a.start();
		b.start();
		const status = (): NetworkStatus => a.links.status();
		expect(status().peers[0]!.reach.state).not.toBe("linked");
		// another computer at the address: not b, nothing kept
		const other = await node("other");
		expect(await a.links.addressSeen(b.id, { host: "127.0.0.1", port: other.port! })).toBe(false);
		expect(a.roster.member(b.id)!.dial).toBeUndefined();
		expect(await a.links.addressSeen(b.id, { host: "127.0.0.1", port: b.port! })).toBe(true);
		expect(a.roster.member(b.id)!.dial).toEqual({ host: "127.0.0.1", port: b.port! });
		await waitFor("a and b to link", () => linked(a, b));
	});

	test("when a member was last seen and synced is this computer's own, and outlives a restart", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		a.start();
		b.start();
		await waitFor("a to sync with b", () => peer(a, b).sync.state === "synced");
		await b.stop();
		await waitFor("a to see b go", () => !peer(a, b).online);
		const seen = peer(a, b);
		await a.restart();
		// b is still away: what a knows of it is what it saved
		const after = peer(a, b);
		expect(after.online).toBe(false);
		expect(after.lastSeen).toBe(a.roster.observed(b.id).lastSeen!);
		expect(after.lastSeen).toBeGreaterThanOrEqual(seen.lastSeen! - 1);
		expect(after.sync).toMatchObject({ state: "synced", lastSuccessAt: a.roster.observed(b.id).lastSync });
		// none of it is in a record
		for (const name of fs.readdirSync(path.join(a.dir, NETWORK_DIR, "spaces"))) {
			expect(fs.readFileSync(path.join(a.dir, NETWORK_DIR, "spaces", name), "utf8")).not.toContain("lastSeen");
		}
	});
});
