// The network as the shell host's mDNS discovery sees it, loaded with
// --preload so main's real discovery opens this instead of a socket. It
// finds nothing.
import { EventEmitter } from "node:events";

class Bonjour {
    find() {
        return Object.assign(new EventEmitter(), {
            update: () => undefined,
            stop: () => undefined,
        });
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
