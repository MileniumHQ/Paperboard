import type { GameServerState } from "../service/types";
import type { PortMove } from "../service/ports";

// The server's names for its ports in Paperboard's port registry.
export const JAVA_PORT_NAME = "java";
export const BEDROCK_PORT_NAME = "bedrock";
/** Geyser's second UDP port, for Bedrock clients connecting over NetherNet */
export const NETHERNET_PORT_NAME = "nethernet";

export function serverPortLabel(name: string, label: string): string {
    return `${name.slice(0, 80 - label.length - 3)} · ${label}`;
}
export function serverPortName(id: string, legacy: boolean, name: string): string {
    return legacy ? name : `${id}-${name}`;
}

/** The port players join on: where this run moved it when the server's own was taken, else the server's. */
export function joinPort(state: Pick<GameServerState, "serverPort" | "portMoves">): string {
    const moved = state.portMoves.find((move) => move.primary);
    return moved ? String(moved.to) : state.serverPort;
}

/** "2456", or "2456–2457" for ports in a row that moved together */
export function portSpan(move: PortMove, from: number): string {
    return (move.count ?? 1) > 1 ? `${from}–${from + move.count! - 1}` : String(from);
}
/**
 * What a run's moved port says, in the console and on the Overview alike:
 * "Ports 2456–2457 were taken, so this run uses 2460–2461". `named` puts the
 * port's label first ("Factorio remote console port 27015 was …").
 */
export function portMoveText(move: PortMove, named: boolean): string {
    const many = (move.count ?? 1) > 1;
    const noun = many ? "ports" : "port";
    const what = named ? `${move.label} ${noun}` : `${noun[0]!.toUpperCase()}${noun.slice(1)}`;
    return `${what} ${portSpan(move, move.from)} ${many ? "were" : "was"} taken, so this run uses ${portSpan(move, move.to)}`;
}
