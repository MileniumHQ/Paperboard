// Where the developer CLI finds Paperboard's data on this computer: the same
// root the daemon and the SDK use (PAPERBOARD_DIR, or ~/.paperboard), so a
// relocated data folder is honoured by every command, and tests never touch
// the developer's real one.
import os from "os";
import path from "path";
import { handshakeFileIn, paperboardDirIn } from "../transport/localHandshake";

export function paperboardDir(): string {
    return paperboardDirIn(os.homedir(), path.join);
}

/** Where panels live, and where `paperapi link` puts its links. */
export function panelsDir(): string {
    return path.join(paperboardDir(), "panels");
}

/** The handshake a running daemon writes for this computer's own clients. */
export function handshakePath(): string {
    return handshakeFileIn(paperboardDir(), path.join);
}
