// The network as the shell host's mDNS discovery sees it, loaded with
// --preload so main's real discovery opens this instead of a socket. It
// finds nothing, and the test can break the open socket the way a network
// change does.
import { EventEmitter } from "node:events";

let browser: EventEmitter | null = null;

class Bonjour {
    find() {
        const opened = Object.assign(new EventEmitter(), {
            update: () => undefined,
            stop: () => {
                if (browser === opened) browser = null;
            },
        });
        browser = opened;
        return opened;
    }
    destroy() {
        // there is no socket to close
    }
}

Bun.plugin({
    name: "shell-host mDNS",
    setup(build) {
        build.module("bonjour-service", () => ({ loader: "object", exports: { Bonjour } }));
    },
});

/** the open socket fails with this message; throws when discovery isn't browsing */
export function failMdns(message: string): void {
    if (!browser) throw new Error("Discovery isn't browsing the network");
    browser.emit("error", new Error(message));
}
