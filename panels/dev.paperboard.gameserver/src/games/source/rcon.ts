import net from "node:net";

// Valve's Source RCON protocol: little-endian packets of
// [size][id][type][body\0][\0], over TCP on the server's game port. A
// command's reply can span several packets, so each command is followed by
// an empty response packet the server mirrors back once the reply is done.
// Paperboard only ever connects on 127.0.0.1.

const AUTH = 3;
const AUTH_RESPONSE = 2;
const EXEC = 2;
const RESPONSE = 0;
const TIMEOUT_MS = 15_000;
/**
 * How long a reply that has begun may go quiet before it counts as whole. The
 * server drops the packet that ends a reply when another connection to the
 * port closes in the same instant (a port scanner's, or a browser's): the
 * command ran and its reply is here, only its end is not. Measured on the
 * Garry's Mod dedicated server, build 26623757.
 */
const QUIET_MS = 2_000;
/** The protocol's limit on a packet's size field. */
const MAX_PACKET = 4096 + 10;

export interface RconPacket { id: number; type: number; body: string }

// Garry's Mod drops a connection whose packet begins with the byte 0x16, the
// first byte of a TLS hello: it takes the packet for a browser's HTTPS request
// ("tried to get banned using the HTTP(S) request to RCON"). A packet begins
// with its size, so that is every 12-byte command and every 12-byte password.
// Measured on the Garry's Mod dedicated server, build 26623757.
const TLS_HELLO = 0x16;
const beginsLikeTls = (body: string) => ((Buffer.byteLength(body, "utf8") + 10) & 0xff) === TLS_HELLO;

/**
 * A command as it is sent: one of the length a server takes for a TLS hello
 * gets a trailing space, which the console ignores.
 */
export const sendableCommand = (command: string) => (beginsLikeTls(command) ? `${command} ` : command);

/** Whether a server that takes such a packet for a TLS hello can be given this password; it can't be padded. */
export const passwordReadAsTls = (password: string) => beginsLikeTls(password);

export function encodePacket(id: number, type: number, body: string): Buffer {
    const text = Buffer.from(body, "utf8");
    const size = 4 + 4 + text.length + 2;
    if (size > MAX_PACKET) throw new Error("RCON command is too long");
    const packet = Buffer.alloc(4 + size);
    packet.writeInt32LE(size, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    text.copy(packet, 12);
    return packet;
}

/** Reads every whole packet from the front of the buffer; the rest waits for more data. */
export function decodePackets(buffer: Buffer): { packets: RconPacket[]; rest: Buffer } {
    const packets: RconPacket[] = [];
    let offset = 0;
    while (buffer.length - offset >= 4) {
        const size = buffer.readInt32LE(offset);
        // a reply to an exec can exceed the request limit, but never by this much
        if (size < 10 || size > 65_536) throw new Error(`RCON sent a malformed packet (size ${size})`);
        if (buffer.length - offset < 4 + size) break;
        const id = buffer.readInt32LE(offset + 4);
        const type = buffer.readInt32LE(offset + 8);
        const body = buffer.subarray(offset + 12, offset + 4 + size - 2).toString("utf8");
        packets.push({ id, type, body });
        offset += 4 + size;
    }
    return { packets, rest: buffer.subarray(offset) };
}

export class RconError extends Error {}
/**
 * The server took the connection but didn't answer in time: it is still
 * loading, or it dropped the reply while banning someone else's bad RCON
 * attempt (an internet scanner). Worth asking again.
 */
export class RconNoAnswer extends RconError {}

/** One authenticated connection, reopened on demand; commands run one at a time. */
export class SourceRcon {
    private socket: net.Socket | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private nextId = 1;
    private waiting: ((packet: RconPacket | Error) => void) | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly port: number, private readonly password: string, private readonly label = "The server", private readonly timeoutMs = TIMEOUT_MS) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`RCON port is not a port: ${port}`);
        if (!password) throw new Error("RCON needs a password");
    }

    /** Runs a console command and resolves with its whole reply. */
    exec(command: string): Promise<string> {
        if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
        const run = this.queue.then(() => this.run(command));
        this.queue = run.catch(() => undefined);
        return run;
    }

    close(): void {
        this.socket?.destroy();
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        // a late reply on the old connection must not answer a command on the next
        this.pending = [];
    }

    private async run(command: string): Promise<string> {
        if (!this.socket) await this.connect();
        const id = this.id();
        const end = this.id();
        this.write(encodePacket(id, EXEC, sendableCommand(command)));
        this.write(encodePacket(end, RESPONSE, ""));
        let reply = "";
        let begun = false;
        for (;;) {
            const packet = await this.read(begun ? QUIET_MS : this.timeoutMs);
            // quiet after the reply began: its end was dropped, and what came is the reply
            if (packet === null) return reply;
            if (packet.id === end) {
                // the mirrored packet is followed by one more the server always sends
                return reply;
            }
            if (packet.id === id && packet.type === RESPONSE) { reply += packet.body; begun = true; }
        }
    }

    private id(): number {
        const id = this.nextId;
        this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
        return id;
    }

    private connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const socket = net.connect({ host: "127.0.0.1", port: this.port });
            const fail = (err: Error) => { socket.destroy(); reject(err); };
            socket.setTimeout(this.timeoutMs);
            socket.once("timeout", () => fail(new RconNoAnswer(`${this.label} did not answer on RCON port ${this.port}`)));
            socket.once("error", (err: NodeJS.ErrnoException) =>
                fail(err.code === "ECONNREFUSED" ? new RconNoAnswer(`${this.label} did not answer on RCON port ${this.port}`) : err));
            socket.once("connect", () => {
                socket.removeAllListeners("error");
                socket.removeAllListeners("timeout");
                this.attach(socket);
                this.authenticate().then(resolve, (err) => { this.close(); reject(err); });
            });
        });
    }

    private attach(socket: net.Socket) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.setTimeout(0);
        socket.on("data", (chunk: Buffer) => {
            // a malformed packet ends the connection and fails the waiting command
            try {
                const decoded = decodePackets(Buffer.concat([this.buffer, chunk]));
                this.buffer = decoded.rest;
                this.pending.push(...decoded.packets);
            } catch (err) {
                this.fail(err as Error);
            }
            this.deliver();
        });
        // a server that quits or restarts may reset the connection rather than close it
        socket.on("error", (err: NodeJS.ErrnoException) => this.fail(err.code === "ECONNRESET" || err.code === "EPIPE" ? new RconError(`${this.label} closed the RCON connection`) : err));
        socket.on("close", () => this.fail(new RconError(`${this.label} closed the RCON connection`)));
    }

    private pending: RconPacket[] = [];
    private deliver() {
        while (this.waiting && this.pending.length > 0) {
            const resolve = this.waiting;
            this.waiting = null;
            resolve(this.pending.shift()!);
        }
    }
    private fail(err: Error) {
        if (this.socket) { this.socket.destroy(); this.socket = null; }
        this.pending = [];
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.(err);
    }

    /** The next packet. With `quietMs`, null when none comes in that time; otherwise that silence fails the command and ends the connection. */
    private read(): Promise<RconPacket>;
    private read(quietMs: number): Promise<RconPacket | null>;
    private read(quietMs?: number): Promise<RconPacket | null> {
        if (this.pending.length > 0) return Promise.resolve(this.pending.shift()!);
        return new Promise<RconPacket | null>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting = null;
                if (quietMs !== undefined && quietMs < this.timeoutMs) { resolve(null); return; }
                this.close();
                reject(new RconNoAnswer(`${this.label} did not finish answering over RCON`));
            }, quietMs ?? this.timeoutMs);
            this.waiting = (packet) => {
                clearTimeout(timer);
                if (packet instanceof Error) reject(packet);
                else resolve(packet);
            };
        });
    }

    private write(packet: Buffer) {
        if (!this.socket) throw new RconError(`${this.label}'s RCON connection is closed`);
        this.socket.write(packet);
    }

    private async authenticate() {
        const id = this.id();
        this.write(encodePacket(id, AUTH, this.password));
        for (;;) {
            const packet = await this.read();
            if (packet.type !== AUTH_RESPONSE) continue;
            if (packet.id === -1) throw new RconError(`${this.label} refused Paperboard's RCON password`);
            if (packet.id === id) return;
        }
    }
}
