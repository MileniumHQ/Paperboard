import { createRead } from "@mileniumhq/paperui";
import { createSignal, type Accessor, type Setter } from "solid-js";
import { errorMessage } from "../../lib/failure";
import { type SourceGameSpec, type SourceMapPictures } from "./index";
import { useServer, type ServerPage } from "../../lib/server";

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
const kept = new WeakMap<ServerPage, { fetched: Accessor<Readonly<Record<string, string | null>>>; setFetched: Setter<Readonly<Record<string, string | null>>>; asked: Set<string> }>();
function keptFor(server: ServerPage) {
    let cache = kept.get(server);
    if (!cache) {
        const [fetched, setFetched] = createSignal<Readonly<Record<string, string | null>>>({});
        cache = { fetched, setFetched, asked: new Set() };
        kept.set(server, cache);
    }
    return cache;
}

/**
 * A game's map pictures, each fetched by the service as it is shown, and the
 * wiki's credit and map names, fetched on mount. A game whose spec names no
 * source has none, and nothing to say about it.
 */
export function createMapPictures(spec: SourceGameSpec): MapPicturesState {
    const server = useServer();
    const { fetched, setFetched, asked } = keptFor(server);
    const hasPictures = Boolean(spec.mapPictures || spec.installPictures);
    const wiki = createRead((): Promise<SourceMapPictures> => server.calls.sourceMapPictures(), { source: () => spec.mapPictures, message: errorMessage });
    const [pictureError, setPictureError] = createSignal("");
    const error = () => wiki.error() ?? pictureError();

    const fetchPicture = async (map: string) => {
        try {
            const picture = await server.calls.sourceMapPicture({ map });
            setFetched((have) => ({ ...have, [map]: picture }));
        } catch (err) {
            // asked again on Try again
            asked.delete(map);
            setPictureError(errorMessage(err));
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
        titleOf: (map) => wiki.value()?.titles[map.toLowerCase()],
        source: () => wiki.value()?.source ?? null,
        error,
        retry: () => {
            setPictureError("");
            void wiki.reload();
            // the cards on screen ask again for what failed
            setFetched((have) => ({ ...have }));
        },
    };
}
