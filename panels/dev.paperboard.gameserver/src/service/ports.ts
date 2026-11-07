import type { PortClaim, PortRequest } from "./api";
import type { LoaderDeps } from "./loaderSettings";
import type { PortSpec } from "../games/serviceTypes";
export interface PortRegistryDeps {
    claim(request: PortRequest): Promise<PortClaim>;
    prepare(name: string): Promise<PortClaim>;
    release(name: string): Promise<void>;
}
export interface PortDeps extends LoaderDeps { ports: PortRegistryDeps }
export interface PortMove { label: string; from: number; to: number }

/**
 * Claims the port the file asks for and writes back a moved one. `starting`
 * also checks the computer right now; only then, since a running server
 * holds its own ports.
 */
export async function claimPort(
    request: PortRequest,
    write: (port: number) => Promise<void>,
    starting: boolean,
    deps: PortDeps,
): Promise<PortMove | null> {
    let { port } = await deps.ports.claim(request);
    if (starting) port = (await deps.ports.prepare(request.name)).port;
    if (port === request.preferred) return null;
    await write(port);
    return { label: request.label, from: request.preferred, to: port };
}

/** Modules own port files; shared infrastructure owns all claims. */
export async function prepareGamePorts(specs: AsyncIterable<PortSpec> | Iterable<PortSpec>, deps: PortDeps): Promise<PortMove[]> {
    const moves: PortMove[] = [];
    for await (const spec of specs) {
        if (spec.preferred === null) {
            await deps.ports.release(spec.name);
            continue;
        }
        const moved = await claimPort({ name: spec.name, label: spec.label, protocol: spec.protocol, preferred: spec.preferred }, spec.write, true, deps);
        if (moved) moves.push(moved);
    }
    return moves;
}
// Existing Minecraft adapters and tests retain their import path.
export { DEFAULT_JAVA_PORT, readJavaPort, prepareServerPorts, claimBedrockPorts } from "../games/minecraft/ports";
