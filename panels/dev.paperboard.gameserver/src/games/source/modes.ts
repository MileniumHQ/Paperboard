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

/**
 * The modes the game lists (`mapModes`) that have an installed map, by name.
 * Prefixes one mode goes by (koth and 2koth) make one mode, named by the
 * first prefix the game lists for it.
 */
export function playModes(spec: Pick<SourceGameSpec, "mapModes">, installed: readonly string[]): SourceMode[] {
    const prefixOf = new Map<string, string>();
    for (const [prefix, name] of Object.entries(spec.mapModes ?? {})) if (!prefixOf.has(name)) prefixOf.set(name, prefix);
    const modes = new Map<string, SourceMode>();
    for (const map of [...installed].sort()) {
        const name = mapMode(spec, map);
        if (name === undefined) continue;
        const mode = modes.get(name) ?? { prefix: prefixOf.get(name)!, name, maps: [] };
        mode.maps.push(map);
        modes.set(name, mode);
    }
    return [...modes.values()].sort((a, b) => a.name.localeCompare(b.name));
}
