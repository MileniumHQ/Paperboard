import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as os from "node:os";
import { defaultRouteIpv4, getNetworkIp, selectNetworkIp, type NetworkInterfaceLike } from "../src/core/util";
import { type InProcessDaemon, startDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// The address a game server's Overview tells players to join, and the one
// a paired computer is offered: it must be the one other machines can reach.
const v4 = (address: string): NetworkInterfaceLike => ({ address, family: "IPv4", internal: false });
const loopback: NetworkInterfaceLike = { address: "127.0.0.1", family: "IPv4", internal: true };

// a Fedora server running Podman lists its bridge before the real card
const fedoraWithPodman = {
	lo: [loopback],
	podman0: [v4("10.88.0.1")],
	enp3s0: [v4("192.168.1.40"), { address: "fe80::1", family: "IPv6", internal: false }],
};

describe("the network address", () => {
	test("is the one the default route leaves from, not a container bridge listed first", () => {
		expect(selectNetworkIp(fedoraWithPodman)).toBe("10.88.0.1");
		expect(selectNetworkIp(fedoraWithPodman, "192.168.1.40")).toBe("192.168.1.40");
		expect(selectNetworkIp({ "vEthernet (WSL)": [v4("172.27.48.1")], Ethernet: [v4("10.0.0.12")] }, "10.0.0.12")).toBe("10.0.0.12");
	});

	test("a routed address this machine does not own is never shown", () => {
		expect(selectNetworkIp(fedoraWithPodman, "192.168.1.99")).toBe("10.88.0.1");
		expect(selectNetworkIp(fedoraWithPodman, "0.0.0.0")).toBe("10.88.0.1");
	});

	test("with no default route, a private address wins over a public one", () => {
		expect(selectNetworkIp({ wan: [v4("203.0.113.7")], lan: [v4("192.168.0.2")] })).toBe("192.168.0.2");
		expect(selectNetworkIp({ wan: [v4("203.0.113.7")] })).toBe("203.0.113.7");
		expect(selectNetworkIp({ lo: [loopback], vpn: [v4("0.0.0.0")] })).toBe("127.0.0.1");
	});

	test("the default route answer is an address of this machine, or none", async () => {
		const owned = Object.values(os.networkInterfaces()).flatMap((list) => (list ?? []).map((item) => item.address));
		const routed = await defaultRouteIpv4();
		if (routed !== null) expect(owned).toContain(routed);
		expect(await getNetworkIp()).toBe(selectNetworkIp(os.networkInterfaces(), routed));
	});
});

describe("system:ip", () => {
	let daemon: InProcessDaemon;
	beforeAll(async () => {
		daemon = await startDaemon();
	});
	afterAll(async () => {
		await daemon.stop();
	});

	test("answers a panel with the same address", async () => {
		const panel = await daemon.panelRpc("test.address");
		try {
			expect((await panel.call("system:ip", {})).result).toEqual({ ip: await getNetworkIp() });
		} finally {
			await panel.close();
		}
	});
});
