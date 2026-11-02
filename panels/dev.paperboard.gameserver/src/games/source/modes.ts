import { mapMode, type SourceGameSpec } from "./index";

/** A way to play a Source game, and the installed maps that play that way. */
export interface SourceMode {
    /** the map prefix that names it ("ctf") */
    prefix: string;
    /** what players call it ("Capture the Flag") */
    name: string;
    /** its installed maps, by name */
    maps: string[];
}

/** The modes the game lists (`mapModes`) that have an installed map, by name. */
export function playModes(spec: Pick<SourceGameSpec, "mapModes">, installed: readonly string[]): SourceMode[] {
    const modes = new Map<string, SourceMode>();
    for (const map of [...installed].sort()) {
        const name = mapMode(spec, map);
        if (name === undefined) continue;
        const prefix = map.split("_")[0]!.toLowerCase();
        const mode = modes.get(prefix) ?? { prefix, name, maps: [] };
        mode.maps.push(map);
        modes.set(prefix, mode);
    }
    return [...modes.values()].sort((a, b) => a.name.localeCompare(b.name));
}
