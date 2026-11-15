// The map's pictures: region tiles the service paints, and player heads it
// composites, held as decoded images for the painter. Tiles are asked for a
// few at a time, nearest the view's centre first, and the oldest drop out
// once the cache is full.
import { createSignal } from "solid-js";
import type { ServerCalls } from "../../lib/api";
import { headsFrom } from "../../lib/skins";
import { errorMessage } from "../../lib/failure";
import type { MapDimension } from "../../core/map";

// the service paints one region at a time; asking for a whole world at once
// only queues work for tiles the view may have left by the time they paint
const MAX_TILE_REQUESTS = 2;
// decoded tiles held in the renderer; panning across a world must not grow
// memory without a bound
const MAX_TILE_CACHE = 256;

export interface TileState {
    image: HTMLImageElement;
    /** the region file's version this image was painted from */
    version: number;
    /** the refresh tick that last asked the service about it */
    checked: number;
}

export interface TileRef {
    dim: MapDimension;
    rx: number;
    rz: number;
}

/** What the pictures tell the map: one arrived, or one failed (by key) and why, or the one that failed went through. */
export interface PictureReport {
    drawn(): void;
    failed(key: string, title: string, message: string): void;
    succeeded(key: string): void;
}

export const tileKey = (dim: MapDimension, rx: number, rz: number) => `${dim}:${rx}:${rz}`;

export function createTileStore(calls: ServerCalls, report: PictureReport) {
    const tiles = new Map<string, TileState>();
    const pending = new Set<string>();
    const [pendingCount, setPendingCount] = createSignal(0);
    // the tiles the view still wants, nearest its centre first
    let wanted: TileRef[] = [];
    let refresh = 0;

    const next = () => {
        while (pending.size < MAX_TILE_REQUESTS) {
            const tile = wanted.shift();
            if (!tile) return;
            request(tile);
        }
    };

    const request = ({ dim, rx, rz }: TileRef) => {
        const key = tileKey(dim, rx, rz);
        if (pending.has(key)) return;
        const existing = tiles.get(key);
        pending.add(key);
        setPendingCount(pending.size);
        const asked = refresh;
        const settle = () => {
            pending.delete(key);
            setPendingCount(pending.size);
            next();
        };
        // a tile already drawn is only asked whether it changed
        calls.renderMapTile({ dimension: dim, rx, rz, since: existing?.version })
            .then((result) => {
                settle();
                if (existing) existing.checked = asked;
                const dataUrl = result?.dataUrl;
                if (!result || !dataUrl) return report.succeeded(key);
                const image = new Image();
                image.onload = () => {
                    tiles.delete(key);
                    tiles.set(key, { image, version: result.version, checked: asked });
                    while (tiles.size > MAX_TILE_CACHE) {
                        const oldest = tiles.keys().next().value;
                        if (oldest === undefined) break;
                        tiles.delete(oldest);
                    }
                    report.succeeded(key);
                    report.drawn();
                };
                image.onerror = () =>
                    report.failed(key, "A map tile didn't render", `The picture the service painted of region ${rx}, ${rz} could not be read.`);
                image.src = dataUrl;
            })
            .catch((err) => {
                settle();
                report.failed(key, "A map tile didn't render", errorMessage(err));
            });
    };

    return {
        tiles: tiles as ReadonlyMap<string, TileState>,
        pendingCount,
        /** whether the tile still needs asking about in refresh tick `tick` */
        stale: (key: string, tick: number) => !pending.has(key) && tiles.get(key)?.checked !== tick,
        /** the tiles the view wants now, nearest its centre first, in refresh tick `tick`; replaces what it wanted before */
        want(list: TileRef[], tick: number) {
            wanted = list;
            refresh = tick;
            next();
        },
    };
}

/**
 * Player heads, composited from Mojang by the service (the browser cannot
 * read the profile endpoint across origins). Each is asked for once; until it
 * arrives a marker draws as a dot. A player without a skin keeps the dot; a
 * lookup or picture that fails says so.
 */
export function createHeads(calls: ServerCalls, report: PictureReport) {
    const loadHead = headsFrom(calls);
    const images = new Map<string, HTMLImageElement>();
    return (name: string): HTMLImageElement | null => {
        const key = name.toLowerCase();
        const existing = images.get(key);
        if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;
        // the slot is taken at once, so a redraw does not start a second lookup
        images.set(key, new Image());
        const failed = (message: string) => report.failed(`head:${key}`, `${name}'s head didn't load`, message);
        loadHead({ name })
            .then((dataUrl) => {
                if (!dataUrl) return;
                const image = new Image();
                image.onload = () => {
                    images.set(key, image);
                    report.drawn();
                };
                image.onerror = () => failed("The service's picture of it could not be read.");
                image.src = dataUrl;
            })
            .catch((err) => {
                failed(errorMessage(err));
            });
        return null;
    };
}
