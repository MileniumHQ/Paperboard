// The links as the daemon runs them: the desktop app's embedded daemon (in
// this process, loopback only, so nobody can dial it) and a daemon on its own
// TLS listener (a compiled crane, a process of its own), each with its own
// data directory. The embedded one dials out, and they sync both ways.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as path from "node:path";
import { memberIdOf } from "../src/network/memberId";
import { Roster } from "../src/network/roster";
import { NETWORK_DIR, RosterRecords } from "../src/network/rosterStore";
import { loadOrCreateTlsIdentity } from "../src/security/tlsIdentity";
import { pinnedRequest } from "../src/security/pinnedTls";
import { standInForJoining } from "./support/standInForJoining";
import { startCrane, type CraneProcess } from "testkit/crane";
import { dataDir } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS * 3);

const cranes: CraneProcess[] = [];
afterEach(async () => {
	await stopDaemon();
	for (const crane of cranes.splice(0)) await crane.stop();
});

/** a data directory's roster and record store, while its daemon isn't running */
async function openStopped(dir: string) {
	const local = path.join(dir, "local");
	const identity = loadOrCreateTlsIdentity(local);
	const members = await RosterRecords.open(path.join(local, NETWORK_DIR), identity);
	const roster = await Roster.open(local, identity, members);
	return { identity, roster, records: members.records };
}

describe("links between running daemons", () => {
	// Inventory: Core contract — the desktop app's own daemon, which nobody can dial, links out and syncs both ways.
	test("the app's loopback-only daemon dials a daemon on the network and they converge", async () => {
		const [deskDir, rackDir] = [dataDir(), dataDir()];
		const desk = await openStopped(deskDir);
		const rack = await openStopped(rackDir);
		await standInForJoining([
			{ records: desk.records, cert: desk.identity.cert },
			{ records: rack.records, cert: rack.identity.cert },
		]);
		await rack.records.put("notes", "from-rack", "written before either started");
		const rackId = memberIdOf(rack.identity.cert);
		desk.roster.close();
		rack.roster.close();

		const crane = await startCrane({ dataDir: rackDir, host: "0.0.0.0" });
		cranes.push(crane);
		expect(crane.handshake.listen.secure).toBe(true);
		// where the rack is dialed, as pairing will have said; it is a computer of its own, so it learns it from the desk
		const deskAgain = await openStopped(deskDir);
		await deskAgain.roster.update(rackId, { dial: { host: "127.0.0.1", port: crane.port } });
		deskAgain.roster.close();

		const daemon = await startDaemon({ dataDir: deskDir });
		const network = daemon.instance.network;
		expect(network.status().listening).toBe(false);
		await network.store.put("notes", "from-desk", "written in the app");
		await waitFor("the rack's note on the desk", () => network.store.get("notes", "from-rack")?.state === "value");
		const rackStatus = () => network.status().peers.find((p) => p.id === rackId)!;
		await waitFor("the desk to have synced with the rack", () => rackStatus().sync.state === "synced");
		expect(rackStatus()).toMatchObject({ online: true, reach: { state: "linked", dialedBy: "this" }, sync: { lastFailure: null } });

		// the rack pulls over the same link: a name given on the desk shows in the rack's own list
		await daemon.instance.roster.update(daemon.instance.roster.self, { name: "Desk" });
		const rackRpc = await crane.rpc();
		await waitFor("the rack to list the desk by its new name", async () => {
			const view = await rackRpc.ok("computers:list");
			return view.members.some((m: { id: string; name?: string }) => m.id === daemon.instance.roster.self && m.name === "Desk");
		});
		rackRpc.ws.close();
		await crane.stop();
		cranes.splice(cranes.indexOf(crane), 1);
		await waitFor("the desk to see the rack go", () => !rackStatus().online);
		expect(rackStatus().lastSeen).not.toBeNull();
		await daemon.stop();
		const rackAfter = await openStopped(rackDir);
		const fromDesk = rackAfter.records.get("notes", "from-desk");
		rackAfter.roster.close();
		expect(fromDesk?.state === "value" && fromDesk.value).toBe("written in the app");
	});

	// Inventory: Security — the daemon's TLS listener takes links only from members, and only on TLS.
	test("a running daemon refuses a link from a computer that isn't a member, and app traffic on the port is unchanged", async () => {
		const rackDir = dataDir();
		const crane = await startCrane({ dataDir: rackDir, host: "0.0.0.0" });
		cranes.push(crane);
		// a computer that counts the rack as a member; the rack doesn't know it
		const strangerDir = dataDir();
		const stranger = await openStopped(strangerDir);
		const rackCert = loadOrCreateTlsIdentity(path.join(rackDir, "local")).cert;
		const rackId = memberIdOf(rackCert);
		await stranger.records.put("@roster", rackId, { cert: rackCert, dial: { host: "127.0.0.1", port: crane.port }, facts: {} });
		stranger.roster.close();
		const daemon = await startDaemon({ dataDir: strangerDir });
		const status = () => daemon.instance.network.status().peers.find((p) => p.id === rackId)!;
		await waitFor("the rack to refuse the stranger", () => status().reach.state === "dialing" && /refused the link \(403\)/.test((status().reach as { lastError?: string }).lastError ?? ""));
		expect(status().sync.state).toBe("never");
		// what the app asks of the rack's TLS port, with no certificate of its own, is answered as before
		const health = await pinnedRequest(`https://127.0.0.1:${crane.port}/health`, rackCert);
		expect(health.status).toBe(200);
	});
});
