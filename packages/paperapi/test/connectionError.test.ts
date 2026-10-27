// A PaperCrane that can't be reached rejects with an Error that says so. A
// browser WebSocket's error event carries no reason, and passing it on
// as-is rejected with undefined, so every failure built on it read
// "undefined". Bun's WebSocket is the same browser API, dialing a real
// port with nothing listening.
import { createServer } from "node:net";
import { expect, test } from "bun:test";
import { CraneTransport } from "../src/ws";

/** a port that was just free: listened on, then let go */
const freePort = () =>
    new Promise<number>((resolve) => {
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as { port: number };
            server.close(() => resolve(port));
        });
    });

test("a PaperCrane that can't be reached rejects with a reason", async () => {
    const port = await freePort();

    const transport = new CraneTransport({ port, token: "tok" });
    const failure = await transport.ensureConnected().then(
        () => null,
        (err: unknown) => err,
    );
    transport.close();
    expect(failure instanceof Error).toBe(true);
    expect((failure as Error).message).toBe(`Couldn't reach PaperCrane at ws://127.0.0.1:${port}`);
});
