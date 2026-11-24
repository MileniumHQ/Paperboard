// The Add computer list follows the network: a computer whose update can't
// be used leaves the list, and the shells are told in one change.
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { DiscoveredComputer } from "../../src/shared/shellContract";
import { DiscoveryService, type Mdns, type MdnsBrowser } from "../../src/main/communication/discovery";

// a network that announces only what the test emits: asking it to look
// again, or closing it, sends nothing
function network() {
    const browser = Object.assign(new EventEmitter(), { update: () => undefined, stop: () => undefined });
    const mdns: Mdns = { find: () => browser as MdnsBrowser, destroy: () => undefined };
    return { browser, mdns };
}

const workshop = { name: "Workshop", fqdn: "Workshop._papercrane._tcp.local", port: 45464, addresses: ["192.168.1.20"], txt: { id: "workshop" } };

test("a computer whose update has no usable address leaves the list in a single change", () => {
    const { browser, mdns } = network();
    const discovery = new DiscoveryService(() => mdns);
    discovery.start();
    browser.emit("up", workshop);
    expect(discovery.list().map((c) => c.id)).toEqual(["workshop:45464"]);

    const updates: DiscoveredComputer[][] = [];
    discovery.on("update", (list: DiscoveredComputer[]) => updates.push(list));
    browser.emit("srv-update", { ...workshop, port: 0 }, workshop);

    expect(updates).toEqual([[]]);
    expect(discovery.list()).toEqual([]);
    discovery.stop();
});
