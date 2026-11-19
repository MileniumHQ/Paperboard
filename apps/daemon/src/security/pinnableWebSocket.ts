// The npm ws client, for connections that pin a certificate. Bun replaces
// the "ws" specifier with its native WebSocket, which ignores Node TLS
// options and always checks the certificate against the URL's host, so it
// cannot pin a self-signed daemon certificate. Under Node (Electron, which
// is what dials remote computers) "ws" already is the npm client; under
// Bun (tests) the same client is loaded from the package's own files.
import { createRequire } from "module";
import * as path from "path";
import { WebSocket } from "ws";

let bunWebSocket: typeof WebSocket | null = null;

export function pinnableWebSocket(): typeof WebSocket {
    if (!process.versions.bun) return WebSocket;
    if (!bunWebSocket) {
        // __filename, not import.meta: Bun defines it in every module, and the
        // app's CommonJS bundle keeps it, where import.meta would be emptied
        const load = createRequire(__filename);
        const dir = path.dirname(load.resolve("ws/package.json"));
        bunWebSocket = load(path.join(dir, "index.js")) as typeof WebSocket;
    }
    return bunWebSocket;
}
