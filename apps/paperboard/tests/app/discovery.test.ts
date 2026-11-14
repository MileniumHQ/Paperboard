import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { DiscoveryService, type Mdns } from "../../src/main/communication/discovery";

// The Add computer list finds computers on the network. When browsing
// breaks (a network change closes the mDNS socket) the list says why, and
// looking again starts browsing again instead of failing until a restart.

// the network as bonjour-service sees it: each open is a new socket
function network() {
    const browsers: (EventEmitter & { update(): void; stop(): void })[] = [];
    let queries = 0;
    let closed = 0;
    const open = (): Mdns => ({
        find: () => {
            const browser = Object.assign(new EventEmitter(), {
                update: () => void queries++,
                stop: () => browser.removeAllListeners(),
            });
            browsers.push(browser);
            return browser;
        },
        destroy: () => void closed++,
    });
    return { browsers, open, queries: () => queries, closed: () => closed };
}

const server = { txt: { id: "machine-1", name: "Basement PC" }, port: 45464, addresses: ["192.168.1.20"], fqdn: "basement._papercrane._tcp.local" };

describe("network discovery", () => {
    test("a browsing failure is said, and the next look browses again", () => {
        const net = network();
        const discovery = new DiscoveryService(net.open);
        discovery.refresh();
        net.browsers[0]!.emit("up", server);
        expect(discovery.found().map((c) => c.name)).toEqual(["Basement PC"]);

        net.browsers[0]!.emit("error", new Error("send EHOSTUNREACH 224.0.0.251:5353"));
        expect(() => discovery.found()).toThrow("Paperboard can't look for computers on this network: send EHOSTUNREACH 224.0.0.251:5353");
        expect(net.closed()).toBe(1);

        // the person opens Add computer again once the network is back
        discovery.refresh();
        expect(net.browsers).toHaveLength(2);
        expect(net.queries()).toBe(2);
        net.browsers[1]!.emit("up", server);
        expect(discovery.found().map((c) => c.name)).toEqual(["Basement PC"]);
        discovery.stop();
    });
});
