import type { GameServerState } from "../service/types";

// The server's names for its ports in Paperboard's port registry.
export const JAVA_PORT_NAME = "java";
export const BEDROCK_PORT_NAME = "bedrock";
/** Geyser's second UDP port, for Bedrock clients connecting over NetherNet */
export const NETHERNET_PORT_NAME = "nethernet";

export function serverPortLabel(name: string, label: string): string {
    return `${name.slice(0, 80 - label.length - 3)} · ${label}`;
}
export function serverPortName(id: string, name: string): string {
    return `${id}-${name}`;
}

/** The port players join on: where this run moved it when the server's own was taken, else the server's. */
export function joinPort(state: Pick<GameServerState, "serverPort" | "portMoves">): string {
    const moved = state.portMoves.find((move) => move.primary);
    return moved ? String(moved.to) : state.serverPort;
}
