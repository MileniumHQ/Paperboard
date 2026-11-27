import type { PortClaim, PortRequest } from "./api";
import type { LoaderDeps } from "./loaderSettings";
import type { PortSpec } from "../games/serviceTypes";
export interface PortRegistryDeps {
    claim(request: PortRequest): Promise<PortClaim>;
    prepare(name: string): Promise<PortClaim>;
    release(name: string): Promise<void>;
}
export interface PortDeps extends LoaderDeps { ports: PortRegistryDeps }
/**
 * A port that was taken, so one run uses another; `primary` is the one
 * players join on. `count` is how many in a row moved with it, when more than one.
 */
export interface PortMove { label: string; from: number; to: number; primary: boolean; count?: number }
/** What a start's ports are: each claimed number by the game's name for it, and the ones that moved. */
export interface RunPorts { ports: ReadonlyMap<string, number>; moves: PortMove[] }

/**
 * Claims the port the server asks for. `starting` also checks the computer
 * right now; only then, since a running server holds its own ports. Gives
 * the number it got, which may be another when the asked one was taken.
 */
export async function claimPort(request: PortRequest, starting: boolean, deps: PortDeps): Promise<number> {
    const claimed = await deps.ports.claim(request);
    const count = request.count ?? 1;
    // a Paperboard from before ports in a row holds one, and the server would open the next unchecked
    if ((claimed.count ?? 1) !== count) throw new Error(`${request.label} needs ${count} ports in a row, which the Paperboard on this computer can't hold; update it`);
    return starting ? (await deps.ports.prepare(request.name)).port : claimed.port;
}

/**
 * Claims every port of a start. A port the registry moves is this run's
 * alone: the game opens it from its launch, and the server's settings keep
 * the one the user chose, which the next start asks for again. A pinned
 * port can't move, so a taken one refuses the start.
 */
export async function prepareGamePorts(specs: AsyncIterable<PortSpec> | Iterable<PortSpec>, deps: PortDeps): Promise<RunPorts> {
    const ports = new Map<string, number>();
    const moves: PortMove[] = [];
    let first = true;
    for await (const spec of specs) {
        const primary = first;
        first = false;
        if (spec.preferred === null) {
            await deps.ports.release(spec.name);
            continue;
        }
        const count = spec.count ?? 1;
        const port = await claimPort({ name: spec.name, label: spec.label, protocol: spec.protocol, preferred: spec.preferred, ...(count > 1 ? { count } : {}) }, true, deps);
        if (port !== spec.preferred) {
            if (spec.pinned) throw new Error(`${spec.label} can't use port ${spec.preferred}: something else has it. ${spec.pinned}`);
            moves.push({ label: spec.label, from: spec.preferred, to: port, primary, ...(count > 1 ? { count } : {}) });
        }
        ports.set(spec.name, port);
    }
    return { ports, moves };
}
// Existing Minecraft adapters and tests retain their import path.
export { DEFAULT_JAVA_PORT, readJavaPort, prepareServerPorts, claimBedrockPorts } from "../games/minecraft/ports";
