import { createSignal, onMount } from "solid-js";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceCalls, type SourceGameSpec, type SourceMapPictures } from "./index";

/** A game's map pictures and names as a screen has them: asked for once, kept, and failing out loud. */
export interface MapPicturesState {
    /** the picture of a map as a data: address, when the game's source has one */
    of(map: string): string | undefined;
    /** whether a map's picture is still on its way, so its card waits instead of saying it has none */
    loading(map: string): boolean;
    /** a map's real name ("2Fort" for ctf_2fort), when the game's source gives one */
    titleOf(map: string): string | undefined;
    /** who the pictures are from; null until they arrive, and for a game with none or its own */
    source(): SourceMapPictures["source"] | null;
    /** why there are no pictures; empty while they load and once they are here */
    error(): string;
    retry(): void;
}

// A map's picture, from its wiki or the game's install, is asked of the
// service when a card first shows its map, and kept for as long as this
// server's page is open: each is a few hundred kilobytes at most, and a
// server can have dozens of maps.
const [fetched, setFetched] = createSignal<Readonly<Record<string, string | null>>>({});
const asked = new Set<string>();

/**
 * A game's map pictures, each fetched by the service as it is shown, and the
 * wiki's credit and map names, fetched on mount. A game whose spec names no
 * source has none, and nothing to say about it.
 */
export function createMapPictures(spec: SourceGameSpec): MapPicturesState {
    const ids = sourceCalls(spec.id);
    const hasPictures = Boolean(spec.mapPictures || spec.installPictures);
    const [wiki, setWiki] = createSignal<SourceMapPictures | null>(null);
    const [error, setError] = createSignal("");
    const loadWiki = async () => {
        try {
            setWiki(await serverBridge.call<SourceMapPictures>(ids.mapPictures));
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    onMount(() => { if (spec.mapPictures) void loadWiki(); });

    const fetchPicture = async (map: string) => {
        try {
            const picture = await serverBridge.call<string | null>(ids.mapPicture, { map });
            setFetched((have) => ({ ...have, [map]: picture }));
        } catch (err) {
            // asked again on Try again
            asked.delete(map);
            setError(errorMessage(err));
        }
    };
    // a Workshop map's picture is its preview, which its card asks for itself
    const fromSource = (map: string) => hasPictures && !map.startsWith("workshop/");

    return {
        of: (map) => {
            if (!fromSource(map)) return undefined;
            if (!asked.has(map)) {
                asked.add(map);
                void fetchPicture(map);
            }
            return fetched()[map] ?? undefined;
        },
        loading: (map) => fromSource(map) && !error() && !(map in fetched()),
        titleOf: (map) => wiki()?.titles[map.toLowerCase()],
        source: () => wiki()?.source ?? null,
        error,
        retry: () => {
            setError("");
            if (spec.mapPictures) void loadWiki();
            // the cards on screen ask again for what failed
            setFetched((have) => ({ ...have }));
        },
    };
}
