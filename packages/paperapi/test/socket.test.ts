// The socket a transport speaks through, against a real WebSocket server on
// loopback that writes its frames byte for byte, so a test chooses where the
// client's reads split.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import net from "node:net";
import { webSocketImpl } from "../src/transport/socket";

const servers: net.Server[] = [];
afterEach(() => {
    for (const s of servers.splice(0)) s.close();
});

const textFrame = (text: string) => {
    const payload = Buffer.from(text);
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
};

// Answers the upgrade, then hands the connection to `talk`.
async function wsServer(talk: (socket: net.Socket) => void): Promise<string> {
    const server = net.createServer((socket) => {
        socket.once("data", (head) => {
            const key = /sec-websocket-key: *(\S+)/i.exec(String(head))?.[1];
            const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
            talk(socket);
        });
    });
    servers.push(server);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    return `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}

// Inventory: Core contracts — a panel's connection survives a listener that runs the event loop while a frame is half read.
for (const withHeaders of [false, true]) {
    test(`a listener that runs the event loop while the next frame is half read keeps the connection${withHeaders ? " (a socket with headers)" : ""}`, async () => {
        const second = textFrame("second");
        let rest!: () => void;
        const url = await wsServer((socket) => {
            // one read: the first frame whole and the second one's start
            socket.write(Buffer.concat([textFrame("first"), second.subarray(0, 3)]));
            rest = () => socket.write(second.subarray(3));
        });
        const Ws = await webSocketImpl(withHeaders);
        const ws = withHeaders ? new Ws(url, { headers: { "x-test": "1" } }) : new Ws(url);
        const heard: string[] = [];
        const closed = new Promise<string>((done) => ws.on("close", (code) => done(`closed ${code}`)));
        const both = new Promise<string>((done) => {
            ws.on("message", (data) => {
                heard.push(String(data));
                if (heard.length === 1) {
                    // bun:test waits for this by running the event loop, as a
                    // panel's own synchronous wait would; the rest of the
                    // second frame arrives meanwhile
                    // quiet: a span for the loop to run in, not a wait for an outcome
                    const arrived = new Promise((ok) => setTimeout(ok, 50));
                    rest();
                    expect(arrived).resolves.toBeUndefined();
                }
                if (heard.length === 2) done("both");
            });
        });
        expect(await Promise.race([both, closed])).toBe("both");
        expect(heard).toEqual(["first", "second"]);
        ws.close();
    });
}
