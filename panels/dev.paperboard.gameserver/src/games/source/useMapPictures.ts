import { createEffect, createSignal, onMount } from "solid-js";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceCalls, type SourceGameSpec, type SourceMapPictures } from "./index";

/** A game's map pictures and names as a screen has them: asked for once, kept, and failing out loud. */
export interface MapPicturesState {
    /** the picture of a map, when the game's source has one */
    of(map: string): string | undefined;
    /** whether a map's picture is still on its way, so its card waits instead of saying it has none */
    loading(map: string): boolean;
    /** a map's real name ("2Fort" for ctf_2fort), when the game's source gives one */
    titleOf(map: string): string | undefined;
    /** who the pictures are from; null until they arrive, and for a game with none or its own */
    source(): SourceMapPictures["source"] | null;
    /** every picture's address */
    all(): string[];
    /** why there are no pictures; empty while they load and once they are here */
    error(): string;
    retry(): void;
}

/**
 * Loads every picture into the browser while there is time, as setup does
 * during the download, so the cards that show them later draw at once.
 */
export function preloadMapPictures(state: MapPicturesState): void {
    const held: HTMLImageElement[] = [];
    createEffect(() => {
        for (const url of state.all()) {
            const image = new Image();
            image.src = url;
            held.push(image);
        }
    });
}

// A picture from the game's install is asked for when a card first shows its
// map, and kept for as long as this server's page is open: each is a few
// hundred kilobytes, and a server can have dozens of maps.
const [installed, setInstalled] = createSignal<Readonly<Record<string, string | null>>>({});
const asked = new Set<string>();

/**
 * Fetches the pictures on mount: a wiki's, or each map's from the game's
 * install as it is shown. A game whose spec names no source has none, and
 * nothing to say about it.
 */
export function createMapPictures(spec: SourceGameSpec): MapPicturesState {
    const [loaded, setLoaded] = createSignal<SourceMapPictures | null>(null);
    const [error, setError] = createSignal("");
    const load = async () => {
        setError("");
        try {
            setLoaded(await serverBridge.call<SourceMapPictures>(sourceCalls(spec.id).mapPictures));
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    onMount(() => { if (spec.mapPictures) void load(); });

    const fromInstall = async (map: string) => {
        try {
            const picture = await serverBridge.call<string | null>(sourceCalls(spec.id).mapPicture, { map });
            setInstalled((have) => ({ ...have, [map]: picture }));
        } catch (err) {
            // asked again on Try again
            asked.delete(map);
            setError(errorMessage(err));
        }
    };
    const ask = (map: string) => {
        if (!spec.installPictures || asked.has(map) || map.startsWith("workshop/")) return;
        asked.add(map);
        void fromInstall(map);
    };

    return {
        of: (map) => {
            if (spec.installPictures) {
                ask(map);
                return installed()[map] ?? undefined;
            }
            return loaded()?.pictures[map.toLowerCase()];
        },
        loading: (map) => Boolean(spec.installPictures) && !error() && !(map in installed()) && !map.startsWith("workshop/"),
        titleOf: (map) => loaded()?.titles[map.toLowerCase()],
        all: () => spec.installPictures
            ? Object.values(installed()).filter((picture): picture is string => picture !== null)
            : Object.values(loaded()?.pictures ?? {}),
        source: () => loaded()?.source ?? null,
        error,
        retry: () => {
            setError("");
            if (spec.mapPictures) void load();
            // the cards on screen ask again for what failed
            setInstalled((have) => ({ ...have }));
        },
    };
}
