// The local handshake every Node client of this computer's daemon shares:
// the developer CLI and the SDK transport in a script the daemon did not
// start.
//
// The daemon writes its loopback port and the host token to
// local/crane.json under the data folder (PAPERBOARD_DIR, or ~/.paperboard).
// The token is full access, so a client only sends it to a listener that
// first proves it holds the same token: the socket opens with a random
// challenge header, and the daemon's first frame is an HMAC of it.
//
// This module imports nothing at runtime, so the browser build can carry it:
// the Node modules it needs are handed in by the caller.
import type * as cryptoType from "crypto";
import type * as fsType from "fs";

export const DAEMON_CHALLENGE_HEADER = "x-papercrane-challenge";
const PROOF_TYPE = "daemon-proof";
const PROOF_CONTEXT = "papercrane-local-proof-v1\n";

export const NOT_RUNNING_HINT = "Start Paperboard, or set PAPERBOARD_DIR to the data folder of the Paperboard you run.";

/** Why a handshake was refused. `unavailable` means no daemon answers right now, which waiting can fix. */
export class HandshakeError extends Error {
    constructor(
        message: string,
        public readonly unavailable: boolean,
        public readonly hint?: string,
    ) {
        super(message);
        this.name = "HandshakeError";
    }
}

export interface Handshake {
    port: number;
    token: string;
    file: string;
}

/** The data folder: PAPERBOARD_DIR, or .paperboard in the home folder. */
export function paperboardDirIn(home: string, join: (...parts: string[]) => string): string {
    const dir = process.env.PAPERBOARD_DIR;
    // `process.env.X = undefined` stores the text "undefined", which would
    // put Paperboard's data in a folder of that name wherever this runs
    if (dir === "undefined" || dir === "null") {
        throw new Error(`PAPERBOARD_DIR is "${dir}": a missing value was written into the environment as text. Set it to the data folder's path, or unset it.`);
    }
    return dir || join(home, ".paperboard");
}

/** Where a running daemon writes its handshake in a data folder. */
export function handshakeFileIn(dataDir: string, join: (...parts: string[]) => string): string {
    return join(dataDir, "local", "crane.json");
}

/** Reads crane.json, refusing anything that is not a running daemon's handshake. */
export function readHandshake(fs: typeof fsType, file: string): Handshake {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new HandshakeError(`Paperboard isn't running: there is no ${file}`, true, NOT_RUNNING_HINT);
        }
        throw new HandshakeError(`Couldn't read ${file}: ${(err as Error).message}`, false);
    }
    let raw: any;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        throw new HandshakeError(`${file} is not valid JSON: ${(err as Error).message}`, false);
    }
    if (!raw || typeof raw !== "object" || typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port <= 0 || raw.port > 65535) {
        throw new HandshakeError(`${file} has no valid port`, false);
    }
    if (raw.token === null) {
        throw new HandshakeError(
            `The Paperboard on port ${raw.port} runs with --no-auth, so it cannot prove who it is`,
            false,
            "Only a daemon that can prove it holds the host token is sent commands; start it without --no-auth.",
        );
    }
    if (typeof raw.token !== "string" || raw.token.length === 0) {
        throw new HandshakeError(`${file} has no valid token`, false);
    }
    return { port: raw.port, token: raw.token, file };
}

/** One connection's challenge: the header to open the socket with, and the check of the daemon's first frame. */
export interface DaemonChallenge {
    headers: Record<string, string>;
    /** Why the frame does not prove the listener holds the handshake's token, or null when it does. */
    refusal(firstFrame: string): HandshakeError | null;
}

export function challengeDaemon(crypto: typeof cryptoType, handshake: Handshake): DaemonChallenge {
    const challenge = crypto.randomBytes(32).toString("hex");
    const address = `127.0.0.1:${handshake.port}`;
    const expected = crypto.createHmac("sha256", handshake.token).update(`${PROOF_CONTEXT}${challenge}`).digest("hex");
    return {
        headers: { [DAEMON_CHALLENGE_HEADER]: challenge },
        refusal(firstFrame) {
            let frame: any;
            try {
                frame = JSON.parse(firstFrame);
            } catch (err) {
                return new HandshakeError(`The listener on ${address} is not Paperboard: its first frame is not JSON (${(err as Error).message})`, false);
            }
            const proof = frame?.type === PROOF_TYPE ? frame.proof : undefined;
            const proven = typeof proof === "string" && /^[a-f0-9]{64}$/.test(proof)
                && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(proof));
            if (proven) return null;
            return new HandshakeError(
                `The listener on ${address} could not prove it is the Paperboard that wrote ${handshake.file}`,
                true,
                "That handshake may be left over from a Paperboard that stopped; start Paperboard again.",
            );
        },
    };
}
