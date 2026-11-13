// Rust's WebSocket remote console ("WebRCON", `+rcon.web 1`): one socket at
// ws://<rcon.ip>:<rcon.port>/<rcon.password>. A command is a JSON frame
// { Identifier, Message, Name }; the server answers with frames
// { Message, Identifier, Type, Stacktrace } that carry the command's
// Identifier, the last of them its reply and any before it the log lines the
// command wrote. A command the server doesn't know gets no frame at all. Its
// log and chat arrive on the same socket unasked, as Identifier 0 and -1.
// Paperboard only ever connects on 127.0.0.1, where the server is told to
// listen. The password is in the address, so the address never reaches an
// error, a log or the state. Measured on build 26498655.

const TIMEOUT_MS = 15_000;
/** a frame longer than this is not a reply Paperboard asked for */
const MAX_FRAME = 4_000_000;

export class RustRconError extends Error {}
/** The remote console took no connection: it is not listening, or it refused the password. */
export class RustRconUnreachable extends RustRconError {}
/** The server sent nothing back for a command, as it does for one it doesn't know. */
export class RustRconSilent extends RustRconError {}

/** A chat line the server pushes: a player's, or the console's own `say` (UserId "0"). */
export interface RustChat {
    /** 0 is everyone's chat, 1 a team's */
    Channel: number;
    Message: string;
    UserId: string;
    Username: string;
}

interface Frame { Message: string; Identifier: number; Type: string }
interface Waiting { take(message: string): void; fail(err: Error): void }

/** One frame off the socket; anything that is not one throws. */
function frame(data: unknown): Frame {
    if (typeof data !== "string") throw new RustRconError("Rust's remote console sent data that is not text");
    if (data.length > MAX_FRAME) throw new RustRconError("Rust's remote console sent a frame too long to be a reply");
    const f = JSON.parse(data) as Partial<Frame> | null;
    if (!f || typeof f.Identifier !== "number" || typeof f.Type !== "string") throw new RustRconError("Rust's remote console sent a frame with no identifier or type");
    return { Message: typeof f.Message === "string" ? f.Message : "", Identifier: f.Identifier, Type: f.Type };
}

/** The chat line a Chat frame's message holds. */
function chatLine(message: string): RustChat {
    const chat = JSON.parse(message) as Partial<RustChat> | null;
    if (!chat || typeof chat.Message !== "string" || typeof chat.Username !== "string") throw new RustRconError("Rust pushed a chat line with no message or name");
    return { Channel: Number(chat.Channel ?? 0), Message: chat.Message, UserId: String(chat.UserId ?? ""), Username: chat.Username };
}

/** One connection, opened on demand and again after the server closes it. */
export class RustRcon {
    private socket: WebSocket | null = null;
    private opening: Promise<WebSocket> | null = null;
    private nextId = 1;
    private waiting = new Map<number, Waiting>();
    /** Chat the server pushes, as it happens. */
    onChat: ((chat: RustChat) => void) | null = null;
    /** Something the server pushed that could not be read; there is no command of Paperboard's to fail with it. */
    onProblem: ((err: Error) => void) | null = null;

    constructor(private readonly port: number, private readonly password: string, private readonly timeoutMs = TIMEOUT_MS) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Rust's RCON port is not a port: ${port}`);
        if (!password) throw new Error("Rust's remote console needs a password");
    }

    private open(): Promise<WebSocket> {
        if (this.socket) return Promise.resolve(this.socket);
        this.opening ??= new Promise<WebSocket>((resolve, reject) => {
            // the address holds the password: it is built here and nowhere else
            const socket = new WebSocket(`ws://127.0.0.1:${this.port}/${this.password}`);
            let opened = false;
            const unreachable = () => new RustRconUnreachable(`Rust's remote console on port ${this.port} took no connection: it is not listening yet, or it refused Paperboard's RCON password`);
            const timer = setTimeout(() => { socket.close(); reject(unreachable()); }, this.timeoutMs);
            socket.onopen = () => { opened = true; clearTimeout(timer); this.socket = socket; resolve(socket); };
            socket.onmessage = (event) => this.receive(event.data);
            // the event's own text names the address, so it is never passed on
            socket.onerror = () => {};
            socket.onclose = () => {
                clearTimeout(timer);
                if (!opened) { reject(unreachable()); return; }
                if (this.socket === socket) this.socket = null;
                const waiting = [...this.waiting.values()];
                this.waiting.clear();
                for (const w of waiting) w.fail(new RustRconError("Rust closed its remote console"));
            };
        }).finally(() => { this.opening = null; });
        return this.opening;
    }

    private receive(data: unknown) {
        try {
            const f = frame(data);
            if (f.Type === "Chat") this.onChat?.(chatLine(f.Message));
            else this.waiting.get(f.Identifier)?.take(f.Message);
        } catch (err) {
            // a frame that can't be read answers no command: whoever listens for problems is told
            const problem = err instanceof RustRconError ? err : new RustRconError(`Rust's remote console sent a frame that is not JSON: ${err instanceof Error ? err.message : String(err)}`);
            if (this.onProblem) this.onProblem(problem);
            else console.error(`[rust] ${problem.message}`);
        }
    }

    /**
     * Runs a console command and resolves with its reply: the first frame
     * that answers it, or with `until` every frame up to the one it accepts,
     * joined by line (a save answers with its progress, then that it is done).
     */
    async exec(command: string, options: { until?: (message: string) => boolean; timeoutMs?: number } = {}): Promise<string> {
        if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
        const socket = await this.open();
        const id = this.id();
        return new Promise<string>((resolve, reject) => {
            const lines: string[] = [];
            const done = (settle: () => void) => { clearTimeout(timer); this.waiting.delete(id); settle(); };
            const timer = setTimeout(() => done(() => reject(new RustRconSilent(`Rust gave no answer to "${command.trim().split(/\s+/)[0]}"`))), options.timeoutMs ?? this.timeoutMs);
            this.waiting.set(id, {
                take: (message) => {
                    lines.push(message);
                    if (!options.until || options.until(message)) done(() => resolve(lines.join("\n")));
                },
                fail: (err) => done(() => reject(err)),
            });
            socket.send(JSON.stringify({ Identifier: id, Message: command, Name: "Paperboard" }));
        });
    }

    private id(): number {
        const id = this.nextId;
        // 0 and -1 are the server's own, for its log and chat
        this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
        return id;
    }

    close(): void {
        const socket = this.socket;
        this.socket = null;
        socket?.close();
    }
}

/** What `serverinfo` answers. */
export interface RustInfo {
    Hostname: string;
    MaxPlayers: number;
    Players: number;
    Queued: number;
    Joining: number;
    EntityCount: number;
    /** seconds since the server started */
    Uptime: number;
    Map: string;
    /** frames a second the server runs at */
    Framerate: number;
    /** megabytes the game itself has in use */
    Memory: number;
    /** "2636.290.1": network, save and patch versions */
    Protocol: string;
}

export function parseInfo(reply: string): RustInfo {
    let parsed: unknown;
    try { parsed = JSON.parse(reply); } catch { throw new Error("Rust's serverinfo answer is not JSON"); }
    const info = parsed as Record<string, unknown> | null;
    if (!info || typeof info !== "object") throw new Error("Rust's serverinfo answer is not an object");
    for (const key of ["MaxPlayers", "Players", "Queued", "Joining", "EntityCount", "Uptime", "Framerate", "Memory"]) if (typeof info[key] !== "number") throw new Error(`Rust's serverinfo answer has no ${key}`);
    for (const key of ["Hostname", "Map", "Protocol"]) if (typeof info[key] !== "string") throw new Error(`Rust's serverinfo answer has no ${key}`);
    return info as unknown as RustInfo;
}

/** A player `playerlist` lists. */
export interface RustPlayer {
    /** the 17-digit Steam id */
    steamId: string;
    name: string;
    ping: number;
    /** seconds since they connected */
    connected: number;
    health: number;
}

export function parsePlayers(reply: string): RustPlayer[] {
    let parsed: unknown;
    try { parsed = JSON.parse(reply); } catch { throw new Error("Rust's player list is not JSON"); }
    if (!Array.isArray(parsed)) throw new Error("Rust's player list is not a list");
    return parsed.map((raw) => {
        const p = raw as Record<string, unknown> | null;
        if (!p || typeof p.SteamID !== "string" || typeof p.DisplayName !== "string") throw new Error("Rust listed a player without a Steam id or a name");
        return { steamId: p.SteamID, name: p.DisplayName, ping: Number(p.Ping ?? 0), connected: Number(p.ConnectedSeconds ?? 0), health: Number(p.Health ?? 0) };
    });
}
