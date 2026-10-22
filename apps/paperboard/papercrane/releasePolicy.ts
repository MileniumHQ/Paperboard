import { semverGt } from "./util";

export interface OrderedRelease {
    version: string;
    sha256?: string;
}

// Signatures establish authority, not freshness. Compare every local floor
// before downloading or taking an installed/staged shortcut. Only RPC host
// paths may grant allowDowngrade; daemon updates always require newer.
export function requireReleaseOrder(
    candidate: OrderedRelease,
    floors: Array<OrderedRelease | null | undefined>,
    options: { allowDowngrade?: boolean; requireNewer?: boolean } = {},
): void {
    if (options.allowDowngrade === true && !options.requireNewer) return;
    for (const floor of floors) {
        if (!floor) continue;
        if (semverGt(candidate.version, floor.version)) continue;
        const same = candidate.version === floor.version &&
            (floor.sha256 === undefined || candidate.sha256?.toLowerCase() === floor.sha256.toLowerCase());
        if (!options.requireNewer && same) continue;
        throw new Error(`Release rollback refused: ${candidate.version} is not newer than ${floor.version}${options.requireNewer ? "" : " or the same release"}`);
    }
}
