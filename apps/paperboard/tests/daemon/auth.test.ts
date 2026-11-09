import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PaperCraneAuth, MAX_PAIRING_FAILURES } from "../../papercrane/auth";
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";
import { dataDir } from "./support/fs";
import { request, startDaemon, stopDaemon } from "./support/inproc";
import { installPanelFiles, serviceSource } from "./support/panels";
import { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

const storeFile = (dir: string) => path.join(dir, "local", "authorized_tokens.json");
const storedTokens = (dir: string): string[] => JSON.parse(fs.readFileSync(storeFile(dir), "utf8")).map((e: any) => e.token);

// Tokens persist and revocation is exact.
describe("tokens persist and revocation is exact", () => {
	test("panel, host and unknown tokens resolve to their claims, and survive a reload with revocations", () => {
		const dir = path.join(dataDir(), "local");
		const auth = new PaperCraneAuth(false, dir);
		auth.injectToken("host-token-1", "host");
		const a = auth.issuePanelToken("test.a");
		const b = auth.issuePanelToken("test.b");
		expect(auth.resolveToken(a)?.panelId).toBe("test.a");
		expect(auth.resolveToken("host-token-1")?.panelId).toBeUndefined();
		expect(auth.resolveToken("pcp_unknown")).toBeNull();
		auth.revokeToken(b);
		auth.dispose();

		const reloaded = new PaperCraneAuth(false, dir);
		expect(reloaded.resolveToken(a)?.panelId).toBe("test.a");
		expect(reloaded.resolveToken("host-token-1")).not.toBeNull();
		expect(reloaded.resolveToken(b)).toBeNull();
		reloaded.dispose();
	});

	test("uninstalling a panel revokes only its tokens, closes its sockets and its next token is new", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.gone" });
		const daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const goneToken = (await host.ok("auth:panel-token", { panelId: "test.gone" })).token;
		const keptToken = (await host.ok("auth:panel-token", { panelId: "test.kept" })).token;
		const serviceToken = daemon.instance.auth.issuePanelToken("test.gone");
		const gone = await Rpc.authed(daemon.url, goneToken);
		const kept = await Rpc.authed(daemon.url, keptToken);

		await host.ok("panel:uninstall", { panelId: "test.gone" });
		expect((await gone.closed).code).toBe(4401);
		expect(daemon.instance.auth.resolveToken(goneToken)).toBeNull();
		expect(daemon.instance.auth.resolveToken(serviceToken)).toBeNull();
		expect(await kept.ok("events:subscribe", { events: [] })).toEqual({ success: true, count: 0 });
		const reissued = daemon.instance.auth.issuePanelToken("test.gone");
		expect(reissued).not.toBe(serviceToken);
		await kept.close();
		await host.close();
	});

	test("revoking a token ends DAV Basic sessions minted from it", async () => {
		const daemon = await startDaemon();
		const host = await daemon.rpc();
		const paired = daemon.instance.auth;
		paired.startPairing();
		const pairer = await Rpc.open(daemon.url);
		const pairToken = (await pairer.ok("auth:pair", { code: paired.getPairingCode() })).token as string;
		const minted = await request(daemon.instance.localPort, { method: "POST", path: "/dav/session", headers: { Authorization: `Bearer ${pairToken}` } });
		expect(minted.status).toBe(200);
		const { user, pass } = JSON.parse(minted.body.toString());
		const basic = { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
		expect((await request(daemon.instance.localPort, { method: "PROPFIND", path: "/dav/", headers: { ...basic, Depth: "0" } })).status).toBe(207);

		expect(await pairer.ok("auth:revoke-self")).toEqual({ revoked: true });
		expect((await request(daemon.instance.localPort, { method: "PROPFIND", path: "/dav/", headers: { ...basic, Depth: "0" } })).status).toBe(401);
		await host.close();
	});

	test("a host revoking itself kills every panel and relay token it minted, after persisting", async () => {
		const daemon = await startDaemon();
		const auth = daemon.instance.auth;
		auth.startPairing();
		const pairer = await Rpc.open(daemon.url);
		const pairToken = (await pairer.ok("auth:pair", { code: auth.getPairingCode() })).token as string;
		const panelToken = (await pairer.ok("auth:panel-token", { panelId: "test.minted" })).token as string;
		const relayToken = (await pairer.ok("auth:panel-token", { panelId: "test.minted", relayTo: "remote-1" })).token as string;
		expect(relayToken.startsWith("pcr_")).toBe(true);
		const panelSocket = await Rpc.authed(daemon.url, panelToken);
		// the daemon's own credential for the panel is not the host's to revoke
		const own = auth.issuePanelToken("test.minted");

		await pairer.ok("auth:revoke-self");
		// persisted by the time the reply arrived
		const stored = storedTokens(daemon.dataDir);
		expect(stored).not.toContain(pairToken);
		expect(stored).not.toContain(panelToken);
		expect(stored).not.toContain(relayToken);
		expect(stored).toContain(own);
		expect((await panelSocket.closed).code).toBe(4401);
		expect((await (await Rpc.open(daemon.url)).call("auth:verify", { token: relayToken })).code).toBe("AUTH_REQUIRED");
	});
});

// Panel credentials are minted by the host only, one per panel, never the master.
describe("panel credentials come from the host, one per panel", () => {
	test("issuePanelToken is stable per panel and does not use the pairing budget", () => {
		const auth = new PaperCraneAuth(false, path.join(dataDir(), "local"));
		const first = auth.issuePanelToken("test.stable");
		expect(first.startsWith("pcp_")).toBe(true);
		expect(auth.issuePanelToken("test.stable")).toBe(first);
		for (let i = 0; i < 250; i++) auth.issuePanelToken(`test.many${i}`);
		auth.startPairing();
		expect(auth.pair(auth.getPairingCode()!, "phone", "127.0.0.1").success).toBe(true);
		auth.dispose();
	});

	test("reserved and malformed ids are not panel ids and get no token", () => {
		const auth = new PaperCraneAuth(false, path.join(dataDir(), "local"));
		for (const id of ["library", "settings", "landing", "app-settings", "default", "../etc", "a/../b", "Test.Upper"]) {
			expect(isPanelId(id)).toBe(false);
			expect(() => auth.issuePanelToken(id)).toThrow();
		}
		auth.dispose();
	});

	test("a panel token cannot mint tokens, and a service gets only its scoped token", async () => {
		const dir = dataDir();
		const probe = path.join(dir, "env-probe.json");
		await installPanelFiles(dir, {
			id: "test.envprobe",
			service: serviceSource({
				extra: `import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(probe)}, JSON.stringify({ panel: process.env.PAPERCRANE_PANEL_TOKEN ?? null, master: process.env.PAPERCRANE_TOKEN ?? null, id: process.env.PAPERBOARD_PANEL_ID }));`,
			}),
		});
		process.env.PAPERCRANE_TOKEN = "leaked-master";
		let daemon: Awaited<ReturnType<typeof startDaemon>>;
		try {
			daemon = await startDaemon({ dataDir: dir });
		} finally {
			delete process.env.PAPERCRANE_TOKEN;
		}
		const env = await waitFor("the service to report its env", () => fs.existsSync(probe) && JSON.parse(fs.readFileSync(probe, "utf8")));
		expect(env.master).toBeNull();
		expect(env.id).toBe("test.envprobe");
		expect(daemon.instance.auth.resolveToken(env.panel)?.panelId).toBe("test.envprobe");

		const panel = await daemon.panelRpc("test.envprobe");
		expect((await panel.fail("auth:panel-token", { panelId: "test.envprobe" })).code).toBe("FORBIDDEN");
		await panel.close();
	});
});

// Pairing is opt-in, constant-time, and penalised per peer.
describe("pairing is opt-in and penalised per peer", () => {
	test("a fresh daemon refuses pairing until it is started; a spaced code then yields a persisted pc_ token", async () => {
		const daemon = await startDaemon();
		const early = await Rpc.open(daemon.url);
		expect((await early.fail("auth:pair", { code: "123456" })).error).toContain("not currently active");

		const code = daemon.instance.auth.startPairing();
		const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
		const pairer = await Rpc.open(daemon.url);
		const token = (await pairer.ok("auth:pair", { code: spaced, clientName: "Laptop" })).token as string;
		expect(token.startsWith("pc_")).toBe(true);
		expect(storedTokens(daemon.dataDir)).toContain(token);
		await early.close();
		await pairer.close();
	});

	test("a wrong code locks only that address, even when it claims another peerAddress", async () => {
		const daemon = await startDaemon();
		const code = daemon.instance.auth.startPairing();
		const wrong = code === "111111" ? "222222" : "111111";
		const attacker = await Rpc.open(daemon.url, { localAddress: "127.0.0.2" });
		expect((await attacker.fail("auth:pair", { code: wrong })).error).toContain("locked for 5 seconds");
		// the right code from the locked address is refused while it is locked
		const retry = await Rpc.open(daemon.url, { localAddress: "127.0.0.2" });
		expect((await retry.fail("auth:pair", { code, peerAddress: "127.0.0.9" })).error).toContain("Pairing locked");
		// another address is not blocked
		const user = await Rpc.open(daemon.url, { localAddress: "127.0.0.3" });
		expect((await user.ok("auth:pair", { code })).token).toMatch(/^pc_/);
		for (const s of [attacker, retry, user]) await s.close();
	});

	test("lockouts escalate, IPv6 /64 and mapped IPv4 share a penalty, and the global budget ends the session", () => {
		let now = 1_000_000;
		const auth = new PaperCraneAuth(false, path.join(dataDir(), "local"), () => now);
		const code = auth.startPairing();
		const wrong = code === "111111" ? "222222" : "111111";
		const fail = (peer: string) => auth.pair(wrong, "x", peer);

		expect(fail("10.0.0.1").remainingSeconds).toBe(5);
		now += 5_001;
		expect(fail("10.0.0.1").remainingSeconds).toBe(5);
		now += 5_001;
		expect(fail("10.0.0.1").remainingSeconds).toBe(30);

		fail("2001:db8:1:2::1");
		expect(auth.pair(code, "x", "2001:db8:1:2:ffff::9").error).toContain("Pairing locked");
		fail("::ffff:192.0.2.7");
		expect(auth.pair(code, "x", "192.0.2.7").error).toContain("Pairing locked");
		expect(auth.isLocked("192.0.2.8").locked).toBe(false);

		// spread misses over many addresses until the session budget runs out
		let failures = 5;
		let last: ReturnType<PaperCraneAuth["pair"]> | null = null;
		for (let host = 1; failures < MAX_PAIRING_FAILURES; host++) {
			for (let i = 0; i < 9 && failures < MAX_PAIRING_FAILURES; i++) {
				now += 31_000;
				last = fail(`10.1.${host}.1`);
				failures++;
			}
		}
		expect(last?.error).toContain("Pairing has ended");
		expect(auth.isPairingActive()).toBe(false);
		expect(auth.pair(code, "x", "10.9.9.9").error).toContain("not currently active");
		auth.dispose();
	});
});
