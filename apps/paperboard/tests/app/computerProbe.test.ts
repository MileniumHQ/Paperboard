import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";

let dataDir: string;
let pool: ConnectionPool;
const previous = process.env.PAPERBOARD_DIR;

beforeAll(async () => {
    // the pool reads and writes its paired computers under the data directory
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-probe-"));
    process.env.PAPERBOARD_DIR = dataDir;
    const { ConnectionPool } = await import("../../src/main/communication/papercrane/ConnectionPool");
    pool = new ConnectionPool();
});

afterAll(() => {
    if (previous === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// a loopback port nothing listens on
async function closedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

// What the Add Computer wizard tells the person about what they typed:
// a bad host is a bad address, a bad port is a bad port, and neither is
// blamed on the other or quietly replaced by the default.
describe("computer probe", () => {
    test("a bad port is named as one, and the host is not blamed", async () => {
        for (const port of ["99999", "0", "abc", "-1", "45464.5", "1e3", "0x50", "", "  "]) {
            const result = await pool.probe("1.2.3.4", port);
            expect(result).toEqual({ reachable: false, error: "That isn't a valid port. Type a whole number from 1 to 65535" });
        }
    });

    test("a malformed host is flagged as an address before its port is looked at", async () => {
        for (const port of ["45464", "99999"]) {
            const result = await pool.probe("not an ip!", port);
            expect(result).toEqual({ reachable: false, error: "That isn't a valid address. Type an IP address or a computer name", invalidAddress: true });
        }
    });

    test("a valid host and port is tried, and what comes back is the network's reason", async () => {
        const port = await closedPort();
        for (const typed of [String(port), ` ${port} `, port]) {
            const result = await pool.probe("127.0.0.1", typed);
            expect(result.reachable).toBe(false);
            expect(result.invalidAddress).toBeUndefined();
            expect(result.error).toStartWith("Connection refused.");
        }
    });
});
