import { createSignal, onMount } from "solid-js";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceActions, type SourceGameSpec, type SourceMapPictures } from "./index";

/** A game's map pictures and names as a screen has them: asked for once, kept, and failing out loud. */
export interface MapPicturesState {
    /** the picture of a map, when the game's source has one */
    of(map: string): string | undefined;
    /** a map's real name ("2Fort" for ctf_2fort), when the game's source gives one */
    titleOf(map: string): string | undefined;
    /** who the pictures are from; null until they arrive, and for a game with none */
    source(): SourceMapPictures["source"] | null;
    /** why there are no pictures; empty while they load and once they are here */
    error(): string;
    retry(): void;
}

/** Fetches the pictures on mount. A game whose spec names no source has none, and nothing to say about it. */
export function createMapPictures(spec: SourceGameSpec): MapPicturesState {
    const [loaded, setLoaded] = createSignal<SourceMapPictures | null>(null);
    const [error, setError] = createSignal("");
    const load = async () => {
        setError("");
        try {
            setLoaded(await serverBridge.call<SourceMapPictures>(sourceActions(spec.id).mapPictures));
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    onMount(() => { if (spec.mapPictures) void load(); });
    return {
        of: (map) => loaded()?.pictures[map.toLowerCase()],
        titleOf: (map) => loaded()?.titles[map.toLowerCase()],
        source: () => loaded()?.source ?? null,
        error,
        retry: () => void load(),
    };
}
