// `papercrane status` and `papercrane pair`: talk to the daemon running on
// this computer for the current data directory, the way the desktop app's
// local client does. crane.json names the loopback port and the host token;
// the daemon proves it holds that token on the very socket before the token
// is sent (handshake.ts), so a program squatting on a stale port learns
// nothing.
import * as crypto from "crypto";
import * as fs from "fs";
import { WebSocket } from "ws";
import { DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, craneHandshakePath, verifyDaemonProof } from "./handshake";
import { PROTOCOL_VERSION } from "./protocol";
import { getPaperboardDir } from "./paths";
import { formatListenAddress } from "./tui";
import { getDisplayHost } from "./util";
import { isLoopbackHost } from "./discovery";
import { EXIT } from "./cli";

const CONNECT_TIMEOUT_MS = 3000;
const RPC_TIMEOUT_MS = 10_000;
const PAIRING_POLL_MS = 1000;

// no daemon is running for this data directory
export class DaemonNotRunning extends Error {}

interface Handshake {
    port: number;
    token: string | null;
    pid?: number;
    listen?: { host: string; port: number; secure: boolean };
}

function readHandshake(): Handshake {
    const file = craneHandshakePath();
    let raw: string;
    try {
        raw = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new DaemonNotRunning(`No Paperboard server daemon is running for ${getPaperboardDir()}.`);
        }
        throw new Error(`Could not read ${file}: ${(err as Error).message}`);
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.port !== "number" || !Number.isInteger(parsed.port) || (parsed.token !== null && typeof parsed.token !== "string")) {
        throw new Error(`${file} is not a daemon handshake (no port or token).`);
    }
    const listen = parsed.listen;
    return {
        port: parsed.port,
        token: parsed.token || null,
        ...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
        ...(listen && typeof listen.host === "string" && typeof listen.port === "number" ? { listen: { host: listen.host, port: listen.port, secure: listen.secure === true } } : {}),
    };
}

export interface LocalDaemon {
    handshake: Handshake;
    call<T = any>(action: string, params?: Record<string, unknown>): Promise<T>;
    close(): void;
}

export async function connectLocalDaemon(): Promise<LocalDaemon> {
    const handshake = readHandshake();
    const challenge = crypto.randomBytes(32).toString("hex");
    const ws = new WebSocket(`ws://127.0.0.1:${handshake.port}`, {
        headers: handshake.token ? { [DAEMON_CHALLENGE_HEADER]: challenge } : {},
        handshakeTimeout: CONNECT_TIMEOUT_MS,
    });
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error("The daemon did not answer within 3 seconds.")), CONNECT_TIMEOUT_MS);
        const fail = (err: Error) => {
            clearTimeout(timer);
            ws.removeAllListeners();
            ws.on("error", () => { /* the rejection below reports it */ });
            ws.terminate();
            const code = (err as NodeJS.ErrnoException).code;
            reject(code === "ECONNREFUSED"
                ? new DaemonNotRunning(`No Paperboard server daemon is running for ${getPaperboardDir()} (its last one stopped without cleaning up).`)
                : err);
        };
        ws.once("error", fail);
        ws.once("close", () => fail(new Error("The daemon closed the connection before it was ready.")));
        const ready = () => {
            clearTimeout(timer);
            ws.removeAllListeners();
            resolve();
        };
        if (!handshake.token) {
            ws.once("open", ready);
            return;
        }
        ws.once("message", (data) => {
            try {
                const message = JSON.parse(String(data));
                if (message?.type !== DAEMON_PROOF_TYPE || !verifyDaemonProof(handshake.token!, challenge, message.proof)) {
                    fail(new Error(`The program on port ${handshake.port} could not prove it is this data directory's daemon.`));
                    return;
                }
                ready();
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
            }
        });
    });

    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const failAll = (err: Error) => {
        for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
        pending.clear();
    };
    ws.on("message", (data) => {
        let message: any;
        try { message = JSON.parse(String(data)); }
        catch (err) { failAll(new Error(`The daemon sent a message that is not JSON: ${(err as Error).message}`)); return; }
        if (message?.type !== "response") return;
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(String(message.error)));
        else waiter.resolve(message.result);
    });
    ws.on("close", () => failAll(new Error("The daemon closed the connection.")));
    ws.on("error", (err) => failAll(err));

    const call = <T>(action: string, params: Record<string, unknown> = {}): Promise<T> => new Promise<T>((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) { reject(new Error("The connection to the daemon is closed.")); return; }
        const id = nextId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`The daemon did not answer ${action} within ${RPC_TIMEOUT_MS / 1000} seconds.`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, action, params: { ...params, ...(handshake.token ? { token: handshake.token } : {}), v: PROTOCOL_VERSION } }));
    });

    if (handshake.token) await call("auth:verify", { token: handshake.token });
    return { handshake, call, close: () => ws.close() };
}

interface PairingStatus {
    active: boolean;
    computers: { name?: string; pairedAt: string }[];
}

export interface DaemonStatus {
    running: boolean;
    dataDir: string;
    version?: string;
    pid?: number;
    hostname?: string;
    listen?: { url: string; host: string; port: number; secure: boolean };
    auth?: boolean;
    pairing?: { active: boolean; computers: { name?: string; pairedAt: string }[] };
}

export async function readDaemonStatus(): Promise<DaemonStatus> {
    const dataDir = getPaperboardDir();
    let daemon: LocalDaemon;
    try {
        daemon = await connectLocalDaemon();
    } catch (err) {
        if (err instanceof DaemonNotRunning) return { running: false, dataDir };
        throw err;
    }
    try {
        const info = await daemon.call<{ version: string; hostname: string }>("system:info");
        const { listen, pid, token } = daemon.handshake;
        return {
            running: true,
            dataDir,
            version: info.version,
            hostname: info.hostname,
            ...(pid !== undefined ? { pid } : {}),
            ...(listen ? { listen: { url: formatListenAddress(listen.host, listen.port, listen.secure), ...listen } } : {}),
            auth: token !== null,
            ...(token !== null ? { pairing: await daemon.call<PairingStatus>("system:pairing-status") } : {}),
        };
    } finally {
        daemon.close();
    }
}

export async function runStatus(json: boolean): Promise<number> {
    const status = await readDaemonStatus();
    if (json) {
        console.log(JSON.stringify(status, null, 2));
        return status.running ? EXIT.OK : EXIT.NOT_RUNNING;
    }
    if (!status.running) {
        console.log(`The Paperboard server daemon is not running for ${status.dataDir}.`);
        return EXIT.NOT_RUNNING;
    }
    const rows: [string, string][] = [
        ["Version", status.version ?? ""],
        ...(status.pid !== undefined ? [["PID", String(status.pid)] as [string, string]] : []),
        ...(status.listen ? [["Listening", status.listen.url] as [string, string]] : []),
        ["Data", status.dataDir],
    ];
    if (!status.auth) rows.push(["Pairing", "off (--no-auth)"]);
    else if (status.pairing) {
        const n = status.pairing.computers.length;
        rows.push(["Paired", n === 1 ? "1 computer" : `${n} computers`]);
        if (status.pairing.active) rows.push(["Pairing", "open (a code is waiting to be entered)"]);
    }
    console.log("The Paperboard server daemon is running.");
    for (const [label, value] of rows) console.log(`  ${label.padEnd(10)} ${value}`);
    return EXIT.OK;
}

// Opens pairing, prints the code and waits for a computer to pair. Ctrl+C
// closes pairing again so no code is left open behind the user's back.
export async function runPair(): Promise<number> {
    const daemon = await connectLocalDaemon();
    if (!daemon.handshake.token) {
        daemon.close();
        throw new Error("This daemon runs with --no-auth, so there is nothing to pair.");
    }
    let interrupted = false;
    let wake: (() => void) | null = null;
    const onInterrupt = () => {
        interrupted = true;
        wake?.();
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    try {
        const before = await daemon.call<PairingStatus>("system:pairing-status");
        const known = new Set(before.computers.map((c) => `${c.name}\n${c.pairedAt}`));
        const { code } = await daemon.call<{ code: string }>("system:pairing-start");
        const listen = daemon.handshake.listen;
        const address = listen ? `${getDisplayHost(listen.host)}:${listen.port}` : null;
        console.log(`Pairing code: ${code.slice(0, 3)} ${code.slice(3)}`);
        console.log("");
        console.log("In Paperboard on the other computer, press Add Computer and pick this computer,");
        console.log(`${address ? `or choose Custom IP and type ${address}. Then ` : "then "}enter the code.`);
        if (listen && isLoopbackHost(listen.host)) {
            console.log(`This daemon only listens on ${listen.host}, so another computer reaches it only through a tunnel (such as ssh -L).`);
        }
        console.log("Pair only on a network you trust; once paired, the connection is encrypted.");
        console.log("");
        console.log("Waiting for a computer to pair... (Ctrl+C cancels)");
        for (;;) {
            await new Promise<void>((resolve) => {
                wake = resolve;
                setTimeout(resolve, PAIRING_POLL_MS);
            });
            wake = null;
            if (interrupted) {
                await daemon.call("system:pairing-cancel");
                console.log("Pairing cancelled.");
                return EXIT.INTERRUPTED;
            }
            const status = await daemon.call<PairingStatus>("system:pairing-status");
            if (status.active) continue;
            const paired = status.computers.find((c) => !known.has(`${c.name}\n${c.pairedAt}`));
            if (paired) {
                console.log(`Paired with ${paired.name || "a computer"}.`);
                return EXIT.OK;
            }
            console.error("Pairing ended without a computer pairing (cancelled on the daemon, or too many wrong codes). Run papercrane pair again for a new code.");
            return EXIT.FAILURE;
        }
    } finally {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onInterrupt);
        daemon.close();
    }
}
