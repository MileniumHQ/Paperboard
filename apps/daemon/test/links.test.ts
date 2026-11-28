import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";
import { WebSocket, WebSocketServer } from "ws";
import { LINK_CLOSE, LINK_PATH, linkProof, NetworkLinks, type LinkLimits, type LinkTiming, type PeerStatus } from "../src/network/links";
import { logger } from "../src/core/logger";
import { memberIdOf } from "../src/network/memberId";
import { Roster } from "../src/network/roster";
import { NETWORK_DIR, RosterRecords } from "../src/network/rosterStore";
import type { RecordStore } from "../src/network/store";
import { createTlsIdentity, loadOrCreateTlsIdentity, type TlsIdentity } from "../src/security/tlsIdentity";
import { ED25519_CERT } from "./support/ed25519Cert";
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
	proofTimeoutMs: 1_000,
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
const servers: https.Server[] = [];
afterEach(async () => {
	for (const node of nodes.splice(0)) await node.stop();
	for (const server of servers.splice(0)) close(server);
});

/** the daemon's TLS listener as it is made: an https server, asking no client for a certificate */
function tlsServer(identity: TlsIdentity): https.Server {
	return https.createServer({ key: identity.key, cert: identity.cert }, (_req, res) => {
		res.statusCode = 404;
		res.end();
	});
}

function close(server: https.Server): void {
	server.close();
	server.closeAllConnections();
}

function listen(server: https.Server, port = 0): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
	});
}

async function node(name: string, options: { listening?: boolean; timing?: Partial<LinkTiming>; limits?: Partial<LinkLimits>; now?: () => number } = {}): Promise<Node> {
	const dir = tempDir(`pb-link-${name}-`);
	const identity = loadOrCreateTlsIdentity(dir);
	const listening = options.listening ?? true;
	let listener: https.Server | null = null;
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
			n.links = new NetworkLinks({ identity, roster: n.roster, store: n.records, listening, timing: { ...FAST, ...options.timing }, limits: options.limits, now: options.now });
			if (listening) {
				listener = tlsServer(identity);
				listener.on("upgrade", (req: http.IncomingMessage, socket, head) => {
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
			await n.roster.close();
			if (listener) {
				const closed = new Promise<void>((resolve) => listener!.once("close", () => resolve()));
				close(listener);
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

/** members of each other (see standInForJoining); each that listens says where first, unless `addresses` is false */
async function members(list: Node[], addresses = true): Promise<void> {
	if (addresses) for (const n of list) if (n.port !== null) await n.roster.listensAt(dialOf(n)!);
	await standInForJoining(list.map((n) => ({ records: n.records, cert: n.identity.cert })));
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
	// Inventory: Core contract — two members link, each sure of the other's key, and end up holding the same records.
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

	// Inventory: Security — only a member's key opens a link; any other computer is told a nonce and nothing more.
	test("a stranger is refused, and a member's address answered by another computer is never trusted", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		// the stranger has let a into its network on its own side; a has never heard of it
		const stranger = await node("stranger", { listening: false });
		await stranger.records.put("@roster", a.id, { cert: a.identity.cert });
		await stranger.roster.update(a.id, { dial: dialOf(a)! });
		await stranger.records.shareKeys([a.identity.cert]);
		a.start();
		stranger.start();
		await waitFor("the stranger to be refused", () => peer(stranger, a).reach.state === "dialing" && /refused the link \(4003\)/.test(String((peer(stranger, a).reach as { lastError: string }).lastError)));
		expect(a.links.status().peers.map((p) => p.id)).toEqual([b.id]);
		expect(peer(stranger, a).sync.state).toBe("never");

		// b is told a's address, but another computer listens there
		await a.stop();
		const impostor = await node("impostor");
		await b.roster.update(a.id, { dial: dialOf(impostor)! });
		impostor.start();
		b.start();
		await waitFor("b to refuse what answered at a's address", () => /another computer answered there|certificate/i.test(String((peer(b, a).reach as { lastError?: string }).lastError ?? "")));
		expect(peer(b, a).online).toBe(false);
		expect(impostor.upgrades).toBe(0);
	});

	// Inventory: Security — listing a computer (a pairing) makes no link; only a member is dialed or let in.
	test("a computer that is only listed is neither dialed nor let in", async () => {
		const [a, b] = [await node("a"), await node("b")];
		// each lists the other, as two 0.4 pairings would; neither shared its keys
		await a.records.put("@roster", b.id, { cert: b.identity.cert });
		await a.roster.update(b.id, { dial: dialOf(b)! });
		await b.records.put("@roster", a.id, { cert: a.identity.cert });
		await b.roster.update(a.id, { dial: dialOf(a)! });
		await a.records.put("notes", "on-a", "stays on a");
		a.start();
		b.start();
		expect(a.links.status().peers).toEqual([]);
		expect(b.links.status().peers).toEqual([]);
		// a member of neither that dials anyway is refused like any stranger
		const dialer = await node("dialer", { listening: false });
		await dialer.records.put("@roster", a.id, { cert: a.identity.cert });
		await dialer.roster.update(a.id, { dial: dialOf(a)! });
		await dialer.records.shareKeys([a.identity.cert]);
		dialer.start();
		await waitFor("a to refuse it", () => /refused the link \(4003\)/.test(String((peer(dialer, a).reach as { lastError?: string }).lastError ?? "")));
		expect(a.upgrades).toBeGreaterThan(0);
		expect(b.upgrades).toBe(0);
		expect(note(b, "on-a")).toBeUndefined();
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
		await waitFor("b to be refused", () => /refused the link \(4003\)/.test(String((peer(b, a).reach as { lastError?: string }).lastError ?? "")));
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
		await waitFor("both dials to have been taken", () => a.upgrades + b.upgrades >= 2);
		// for a moment both may hold the larger id's dial, which each took first; they end on the smaller id's
		const [smaller, larger] = ordered(a, b);
		const settled = () =>
			linked(a, b) &&
			(peer(smaller, larger).reach as { dialedBy?: string }).dialedBy === "this" &&
			(peer(larger, smaller).reach as { dialedBy?: string }).dialedBy === "peer";
		await waitFor("both on the link the smaller id dialed", settled);
		// and stay there: the kept link syncs, nobody redials, and the dropped one was no failure
		const upgrades = a.upgrades + b.upgrades;
		await a.records.put("notes", "x", 1);
		await waitFor("the note over the kept link", () => note(b, "x") === 1);
		await b.records.put("notes", "y", 2);
		await waitFor("the note back over it", () => note(a, "y") === 2);
		expect(settled()).toBe(true);
		expect(a.upgrades + b.upgrades).toBe(upgrades);
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
			const broken = tlsServer(identity);
			servers.push(broken);
			const wss = new WebSocketServer({ noServer: true });
			broken.on("upgrade", (req, socket, head) =>
				wss.handleUpgrade(req, socket, head, (ws) => {
					// it lets the dialer prove itself, welcomes it, then breaks
					ws.send(JSON.stringify({ t: "hello", v: 1, nonce: crypto.randomBytes(32).toString("base64") }));
					ws.once("message", () => {
						ws.send(JSON.stringify({ t: "welcome" }));
						if (misbehaves === "garbage") ws.send("this is not a link message");
						// a stalled daemon reads every request and answers none
					});
				}),
			);
			const port = await listen(broken);
			const id = memberIdOf(identity.cert);
			await members([a, b]);
			await a.records.put("@roster", id, { cert: identity.cert });
			await a.roster.update(id, { dial: { host: "127.0.0.1", port } });
			await a.records.shareKeys([identity.cert]);
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
		// none of it is in a record: not in what the roster reads back, nor in any file of the store
		expect(JSON.stringify(a.roster.member(b.id))).not.toMatch(/lastSeen|lastSync|observed/);
		const spaces = path.join(a.dir, NETWORK_DIR, "spaces");
		for (const name of fs.readdirSync(spaces, { recursive: true, encoding: "utf8" })) {
			const file = path.join(spaces, name);
			if (fs.statSync(file).isFile()) expect(fs.readFileSync(file, "utf8")).not.toContain("lastSeen");
		}
	});
});

// A socket to a node's /network that does only what a test tells it: the
// dialer's half of the proof exchange, done by hand.
interface RawDial {
	ws: WebSocket;
	messages: Record<string, unknown>[];
	closed: { code: number; reason: string } | null;
	/** the HTTP status the upgrade was refused with */
	status: number | null;
	error: string | null;
}

function rawDial(to: Node, localAddress?: string): RawDial {
	const ws = new WebSocket(`wss://127.0.0.1:${to.port}${LINK_PATH}`, { rejectUnauthorized: false, ...(localAddress ? { localAddress } : {}) });
	const raw: RawDial = { ws, messages: [], closed: null, status: null, error: null };
	ws.on("message", (data) => raw.messages.push(JSON.parse(data.toString())));
	ws.on("close", (code, reason) => {
		raw.closed = { code, reason: reason.toString() };
	});
	ws.on("unexpected-response", (_req, res) => {
		raw.status = res.statusCode ?? null;
		raw.closed = { code: 1006, reason: "refused" };
		ws.terminate();
	});
	ws.on("error", (err) => {
		raw.error = err.message; // quiet: the test reads how the socket ended from closed and status
	});
	return raw;
}

async function nonceOf(raw: RawDial): Promise<Buffer> {
	await waitFor("the hello", () => raw.messages.length > 0 || raw.closed !== null);
	const hello = raw.messages[0];
	if (hello?.t !== "hello") throw new Error(`no hello: ${JSON.stringify(raw.closed)}`);
	return Buffer.from(hello.nonce as string, "base64");
}

async function closedWith(raw: RawDial, code: number, reason?: RegExp): Promise<void> {
	await waitFor(`the socket to close with ${code}`, () => raw.closed !== null);
	expect(raw.closed!.code).toBe(code);
	if (reason) expect(raw.closed!.reason).toMatch(reason);
}

describe("proving who dials", () => {
	// Inventory: Core contract — a record as big as a record may be crosses a link whose frames are small.
	test("a message far bigger than a frame crosses a link in parts", async () => {
		const [a, b] = [await node("a"), await node("b")];
		await members([a, b]);
		// three UTF-16 units each, so the cuts between parts fall in the middle of emoji too
		const big = "é😀".repeat(100_000);
		await a.records.put("notes", "big", big);
		a.start();
		b.start();
		await waitFor("b to get the big note", () => note(b, "big") !== undefined);
		expect(note(b, "big")).toBe(big);
		expect(peer(b, a).sync.lastFailure).toBeNull();
	});

	// Inventory: Security — a proof opens the one socket its nonce was sent on.
	test("a proof seen on one socket opens no other", async () => {
		const [a, b] = [await node("a"), await node("b", { listening: false })];
		await members([a, b]);
		a.start();
		const first = rawDial(a);
		const proof = linkProof(b.identity, await nonceOf(first), a.id);
		first.ws.send(JSON.stringify(proof));
		await waitFor("a to welcome b", () => first.messages.some((m) => m.t === "welcome"));
		await waitFor("a to count b online", () => peer(a, b).online);
		first.ws.close();
		await waitFor("a to see b go", () => !peer(a, b).online);

		const second = rawDial(a);
		await nonceOf(second);
		second.ws.send(JSON.stringify(proof));
		await closedWith(second, LINK_CLOSE.unproven, /doesn't verify/);
		expect(second.messages.map((m) => m.t)).toEqual(["hello"]);
		expect(peer(a, b).online).toBe(false);
	});

	// Inventory: Security — a member that is dialed can't pass the dialer's proof on to a third computer.
	test("a member's proof is good only for the computer it dialed", async () => {
		// m is a member a trusts; c dials m, and m tries to link to a as c
		const [a, c, m] = [await node("a"), await node("c", { listening: false }), await node("m", { listening: false })];
		await members([a, c, m]);
		a.start();
		// m hands c the nonce a sent it; c signs for the computer it dialed, m
		const asIs = rawDial(a);
		asIs.ws.send(JSON.stringify(linkProof(c.identity, await nonceOf(asIs), m.id)));
		await closedWith(asIs, LINK_CLOSE.unproven, /for another computer/);
		// m says c dialed a: the signature says otherwise
		const rewritten = rawDial(a);
		rewritten.ws.send(JSON.stringify({ ...linkProof(c.identity, await nonceOf(rewritten), m.id), dialed: a.id }));
		await closedWith(rewritten, LINK_CLOSE.unproven, /doesn't verify/);
		// and m can't sign as c at all
		const forged = rawDial(a);
		forged.ws.send(JSON.stringify({ ...linkProof(m.identity, await nonceOf(forged), a.id), cert: c.identity.cert }));
		await closedWith(forged, LINK_CLOSE.unproven, /doesn't verify/);
		expect(peer(a, c).online).toBe(false);
		expect(a.links.status().unproven).toBe(0);
	});

	// Inventory: Security — a certificate anyone may send can't take the daemon down.
	test("a proof with a key that isn't P-256, or with no proof in it at all, is refused and nothing breaks", async () => {
		const a = await node("a");
		a.start();
		for (const cert of [ED25519_CERT, "not a certificate"]) {
			const raw = rawDial(a);
			await nonceOf(raw);
			raw.ws.send(JSON.stringify({ t: "proof", cert, dialed: a.id, sig: Buffer.alloc(64).toString("base64") }));
			await closedWith(raw, LINK_CLOSE.unproven);
		}
		// a still takes links
		const after = rawDial(a);
		await nonceOf(after);
	});

	// Inventory: Security — holding a key proves who you are, not that you belong.
	test("a computer that proves its key but isn't a member is refused", async () => {
		const a = await node("a");
		const stranger = createTlsIdentity();
		a.start();
		const raw = rawDial(a);
		raw.ws.send(JSON.stringify(linkProof(stranger, await nonceOf(raw), a.id)));
		await closedWith(raw, LINK_CLOSE.notMember);
		expect(a.links.status().peers).toEqual([]);
		// its own key isn't a member of itself either
		const self = rawDial(a);
		self.ws.send(JSON.stringify(linkProof(a.identity, await nonceOf(self), a.id)));
		await closedWith(self, LINK_CLOSE.notMember);
	});

	// Inventory: Security — the link endpoint holds nothing for a socket that doesn't prove itself.
	test("a socket that doesn't prove itself in time, sends anything else, or sends too much is closed and never a link", async () => {
		const [a, b] = [await node("a", { timing: { proofTimeoutMs: 300 } }), await node("b", { listening: false })];
		await members([a, b]);
		a.start();
		const silent = rawDial(a);
		await nonceOf(silent);
		expect(a.links.status().unproven).toBe(1);
		await closedWith(silent, LINK_CLOSE.unproven, /Didn't prove itself within 300 ms/);
		expect(peer(a, b).online).toBe(false);

		// a request before a proof isn't read
		const early = rawDial(a);
		await nonceOf(early);
		early.ws.send(JSON.stringify({ t: "req", n: 1, op: "changes", cursor: null, limit: 1 }));
		await closedWith(early, LINK_CLOSE.unproven, /other than a proof/);
		expect(early.messages.map((m) => m.t)).toEqual(["hello"]);

		// a frame far bigger than a proof is cut off before it is gathered
		const flood = rawDial(a);
		await nonceOf(flood);
		flood.ws.send("x".repeat(8 * 1024 * 1024));
		// over the frame limit: the WebSocket refuses it as too big, before it is read
		await closedWith(flood, 1009);
		expect(flood.messages.map((m) => m.t)).toEqual(["hello"]);
		await waitFor("nothing left unproven", () => a.links.status().unproven === 0);
		expect(peer(a, b).online).toBe(false);
	});

	// Inventory: Security — sockets waiting to prove themselves are capped, from one address and in all.
	test("only so many unproven sockets are open at once, from one address and in all", async () => {
		const [a, b] = [await node("a", { limits: { unprovenTotal: 3, unprovenPerAddress: 2 }, timing: { proofTimeoutMs: 60_000 } }), await node("b", { listening: false })];
		await members([a, b]);
		a.start();
		const held = [rawDial(a, "127.0.0.1"), rawDial(a, "127.0.0.1")];
		for (const raw of held) await nonceOf(raw);
		const thirdHere = rawDial(a, "127.0.0.1");
		await waitFor("the third from one address to be refused", () => thirdHere.closed !== null);
		expect(thirdHere.status).toBe(503);
		// another address may still wait, up to the total
		const elsewhere = rawDial(a, "127.0.0.2");
		await nonceOf(elsewhere);
		const pastTotal = rawDial(a, "127.0.0.3");
		await waitFor("one past the total to be refused", () => pastTotal.closed !== null);
		expect(pastTotal.status).toBe(503);
		expect(a.links.status().unproven).toBe(3);
		// one that goes frees its place
		held[0]!.ws.close();
		await waitFor("its place to be freed", () => a.links.status().unproven === 2);
		const again = rawDial(a, "127.0.0.1");
		await nonceOf(again);
		// a proof frees the place it held
		again.ws.send(JSON.stringify(linkProof(b.identity, Buffer.from(again.messages[0]!.nonce as string, "base64"), a.id)));
		await waitFor("b online", () => peer(a, b).online);
		expect(a.links.status().unproven).toBe(2);
		// an upgrade the WebSocket can't take holds no place either
		const reply = await new Promise<string>((resolve) => {
			const socket = tls.connect({ port: a.port!, host: "127.0.0.1", rejectUnauthorized: false }, () =>
				socket.write(`GET ${LINK_PATH} HTTP/1.1\r\nHost: a\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`),
			);
			let got = "";
			socket.on("data", (data: Buffer) => {
				got += data;
			});
			socket.on("close", () => resolve(got));
		});
		expect(reply).toStartWith("HTTP/1.1 400");
		expect(a.links.status().unproven).toBe(2);
	});

	// Inventory: Security — strangers with new keys for every try grow neither memory nor the log.
	test("refused strangers are said once each, a few an hour, and the rest in one line", async () => {
		let clock = Date.now();
		const a = await node("a", { now: () => clock });
		a.start();
		const warned: string[] = [];
		const warn = logger.warn;
		logger.warn = (msg: string) => {
			if (msg.startsWith("[network] refused")) warned.push(msg);
		};
		try {
			const refuse = async (identity: TlsIdentity) => {
				const raw = rawDial(a);
				raw.ws.send(JSON.stringify(linkProof(identity, await nonceOf(raw), a.id)));
				await closedWith(raw, LINK_CLOSE.notMember);
			};
			const again = createTlsIdentity();
			await refuse(again);
			await refuse(again);
			expect(warned).toHaveLength(1);
			for (let i = 0; i < 30; i++) await refuse(createTlsIdentity());
			expect(warned).toHaveLength(16);
			// the next hour's first refusal says how many went unsaid
			clock += 60 * 60_000;
			await refuse(createTlsIdentity());
			expect(warned).toHaveLength(18);
			expect(warned[16]).toMatch(/refused 15 more link\(s\) in the last hour/);
		} finally {
			logger.warn = warn;
		}
	});
});
