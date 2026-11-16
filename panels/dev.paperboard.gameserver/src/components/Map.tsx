import { batch, createEffect, createSignal, For, onCleanup, onMount, Show, on, type Accessor } from "solid-js";
import {
    PaperButton,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    dismissToast,
    showError,
} from "@mileniumhq/paperui";
import { listMapRegions, type MapDimensionRegions, type MapRegionsResult } from "../lib/map";
import { DIMENSION_LABELS, REGION_BLOCKS, type MapDimension } from "../core/map";
import { useServer } from "../lib/server";
import styles from "./Map.module.css";
import { errorMessage } from "../lib/failure";
import { createHeads, createTileStore, tileKey, type PictureReport } from "./map/tiles";
import { paintMap } from "./map/paint";
import { attachGestures, clampScale } from "./map/gestures";

// how much of the map the terrain fills when it opens
const TERRAIN_FILL = 0.8;
const POSITION_POLL_MS = 2000;
// a region file changes when the server saves the world, minutes apart
const TILE_REFRESH_MS = 30_000;
// new regions appear while the server generates; re-list on a slower clock
// so the map can show terrain beyond what existed when the tab opened
const REGION_REFRESH_MS = 15000;

/** a coordinate typed into a go-to field, or null while it isn't one */
const coordinate = (typed: string): number | null => {
    const text = typed.trim();
    const value = Number(text);
    return text !== "" && Number.isFinite(value) ? value : null;
};

// Full-bleed top-down world map: region tiles rendered by the service,
// online players drawn as markers, per-dimension. Pans by drag, zooms on
// the cursor, pinches on touch, and refreshes both tiles and positions on
// its own. This wires the pictures (map/tiles), the painter (map/paint) and
// the gestures (map/gestures) to the view and its controls.
export default function MapView() {
    const { calls, onlinePlayerNames, playerPositions, seenPlayerNames, serverStatus } = useServer();
    const [info, setInfo] = createSignal<MapRegionsResult | null>(null);
    // why the region files could not be listed, until a listing goes through
    const [regionsError, setRegionsError] = createSignal<string | null>(null);
    const [dimension, setDimension] = createSignal<MapDimension>("overworld");
    const [grabbing, setGrabbing] = createSignal(false);
    const [scale, setScale] = createSignal(1);
    const [offsetX, setOffsetX] = createSignal(0);
    const [offsetY, setOffsetY] = createSignal(0);
    const [revision, setRevision] = createSignal(0);
    const [tileRefresh, setTileRefresh] = createSignal(0);
    const [selectedPlayer, setSelectedPlayer] = createSignal("");
    const [coordX, setCoordX] = createSignal("");
    const [coordZ, setCoordZ] = createSignal("");
    // world coords under the pointer, null when it leaves the map
    const [cursor, setCursor] = createSignal<{ x: number; z: number } | null>(null);

    let canvas: HTMLCanvasElement | undefined;
    let wrapper: HTMLDivElement | undefined;
    let centeredView = false;

    // a tile, head, position or drawing failure stays until everything it
    // names goes through, or it is closed: tiles that fail alike share one toast
    const failures = new Map<string, string>();
    const report: PictureReport = {
        drawn: () => setRevision((v) => v + 1),
        failed: (key, title, message) => failures.set(key, showError(title, message)),
        succeeded: (key) => {
            const id = failures.get(key);
            if (id === undefined) return;
            failures.delete(key);
            if (![...failures.values()].includes(id)) dismissToast(id);
        },
    };
    onCleanup(() => {
        for (const id of failures.values()) dismissToast(id);
    });
    const store = createTileStore(calls, report);
    const head = createHeads(calls, report);

    // a world nobody has played on holds only its spawn: the map says why it is so small
    const [explained, setExplained] = createSignal(false);
    const unexplored = () => !explained() && (info()?.dimensions?.length ?? 0) > 0 && playerKeys().length === 0;
    const availableDimensions = () => info()?.dimensions?.map((d) => d.dimension) ?? [];
    const regionsFor = (dim: MapDimension) =>
        info()?.dimensions?.find((d) => d.dimension === dim)?.regions ?? [];
    const playerKeys = () =>
        Array.from(new Set([...seenPlayerNames(), ...onlinePlayerNames()])).sort();

    const sizeOf = () => ({
        width: canvas?.clientWidth ?? 0,
        height: canvas?.clientHeight ?? 0,
    });

    const visibleTiles = () => {
        const { width, height } = sizeOf();
        if (width === 0 || height === 0) return [];
        const s = scale();
        const left = Math.floor(-offsetX() / s / REGION_BLOCKS);
        const top = Math.floor(-offsetY() / s / REGION_BLOCKS);
        const right = Math.floor((width - offsetX()) / s / REGION_BLOCKS);
        const bottom = Math.floor((height - offsetY()) / s / REGION_BLOCKS);
        const available = new Set(
            regionsFor(dimension()).map((r) => `${r.x}:${r.z}`),
        );
        const out: { rx: number; rz: number }[] = [];
        for (let rx = left; rx <= right; rx++) {
            for (let rz = top; rz <= bottom; rz++) {
                if (available.has(`${rx}:${rz}`)) out.push({ rx, rz });
            }
        }
        return out;
    };

    const draw = () => {
        if (!canvas) return;
        try {
            paintMap(canvas, { ...sizeOf(), scale: scale(), offsetX: offsetX(), offsetY: offsetY(), dimension: dimension() }, store.tiles, playerPositions(), head);
            report.succeeded("draw");
        } catch (err) {
            report.failed("draw", "Couldn't draw the map", errorMessage(err));
        }
    };

    // one view change is one draw: scale and offsets are set together
    const centerOnWorld = (x: number, z: number) => {
        const { width, height } = sizeOf();
        batch(() => {
            setOffsetX(width / 2 - x * scale());
            setOffsetY(height / 2 - z * scale());
        });
    };

    // world coordinates at the center of the viewport (screen -> world is
    // the inverse of the draw transform: screen = world * scale + offset)
    const centerCoords = () => {
        const { width, height } = sizeOf();
        const s = scale();
        if (!s) return { x: 0, z: 0 };
        return {
            x: (width / 2 - offsetX()) / s,
            z: (height / 2 - offsetY()) / s,
        };
    };

    // both fields must hold a number: an empty one is not 0
    const goToCoords = () => {
        const x = coordinate(coordX());
        const z = coordinate(coordZ());
        if (x === null || z === null) return;
        centerOnWorld(x, z);
    };

    // the whole generated terrain in view, with a margin: a new world's few
    // chunks fill the map instead of sitting small in a corner of their region
    const fitTerrain = (terrain: MapDimensionRegions["terrain"]) => {
        const { width, height } = sizeOf();
        const fit = Math.min(width / (terrain.maxX - terrain.minX), height / (terrain.maxZ - terrain.minZ)) * TERRAIN_FILL;
        batch(() => {
            setScale(clampScale(fit));
            centerOnWorld((terrain.minX + terrain.maxX) / 2, (terrain.minZ + terrain.maxZ) / 2);
        });
    };

    // switching dimension fits that dimension's terrain, so the Nether/End
    // never open on empty space the overworld was centred on
    const switchDimension = (dim: MapDimension) => {
        setDimension(dim);
        const terrain = info()?.dimensions?.find((d) => d.dimension === dim)?.terrain;
        if (terrain) fitTerrain(terrain);
    };

    const goToPlayer = (name: string) => {
        setSelectedPlayer(name);
        const pos = playerPositions().get(name.toLowerCase());
        if (!pos) return;
        const dim = pos.dimension.replace("minecraft:", "") as MapDimension;
        if (availableDimensions().includes(dim) && dim !== dimension()) {
            switchDimension(dim);
        }
        centerOnWorld(pos.x, pos.z);
    };

    const loadRegions = async () => {
        try {
            const result = await listMapRegions(calls);
            batch(() => {
                setInfo(result);
                setRegionsError(null);
            });
            const dims = result.dimensions;
            if (dims.length === 0) return;
            // keep the user's dimension on a refresh; fall back to the
            // overworld (or whatever exists) only when it disappeared
            const current = dims.find((d) => d.dimension === dimension());
            const target =
                current ??
                dims.find((d) => d.dimension === "overworld") ??
                dims[0];
            if (!centeredView || !current) {
                setDimension(target.dimension);
                fitTerrain(target.terrain);
            }
            centeredView = true;
        } catch (err) {
            setRegionsError(errorMessage(err));
        }
    };

    // live positions arrive as state; asking for them can fail, and says so
    const askPositions = () =>
        calls.queryPlayerPositions().then(
            () => report.succeeded("positions"),
            (err) => report.failed("positions", "Couldn't read the player positions", errorMessage(err)),
        );

    onMount(() => {
        if (!canvas || !wrapper) throw new Error("The map's canvas was not made");
        const resize = () => {
            // a phone's screen has more pixels than CSS px; drawing at 1:1 would blur
            canvas!.width = Math.round(wrapper!.clientWidth * devicePixelRatio);
            canvas!.height = Math.round(wrapper!.clientHeight * devicePixelRatio);
            setRevision((v) => v + 1);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(wrapper);
        const detach = attachGestures(canvas, { scale, offsetX, offsetY, setScale, setOffsetX, setOffsetY }, { grabbing: setGrabbing, cursor: setCursor });

        const positionPoll = setInterval(() => {
            if (serverStatus() === "online") void askPositions();
        }, POSITION_POLL_MS);
        const tilePoll = setInterval(
            () => setTileRefresh((v) => v + 1),
            TILE_REFRESH_MS,
        );
        // regions generated since mount become visible without a reload
        const regionPoll = setInterval(() => void loadRegions(), REGION_REFRESH_MS);

        onCleanup(() => {
            observer.disconnect();
            detach();
            clearInterval(positionPoll);
            clearInterval(tilePoll);
            clearInterval(regionPoll);
        });

        void loadRegions();
    });

    // fetch newly visible tiles only when the view/dimension/refresh clock
    // changes — NOT on every position tick, so markers don't spam the service
    const view: Accessor<unknown>[] = [revision, tileRefresh, scale, offsetX, offsetY, info, dimension];
    createEffect(on(view, () => {
        const dim = dimension();
        const refresh = tileRefresh();
        const { width, height } = sizeOf();
        // in region units, like the tiles themselves
        const centerX = (width / 2 - offsetX()) / scale() / REGION_BLOCKS - 0.5;
        const centerZ = (height / 2 - offsetY()) / scale() / REGION_BLOCKS - 0.5;
        const fromCenter = (t: { rx: number; rz: number }) => (t.rx - centerX) ** 2 + (t.rz - centerZ) ** 2;
        store.want(
            visibleTiles()
                // a drawn tile is asked about again once per refresh
                .filter((t) => store.stale(tileKey(dim, t.rx, t.rz), refresh))
                .sort((a, b) => fromCenter(a) - fromCenter(b))
                .map((t) => ({ dim, rx: t.rx, rz: t.rz })),
            refresh,
        );
    }));

    // redraw on any view or position change
    createEffect(on([...view, playerPositions], draw));

    return (
        <div ref={wrapper} class={styles.map}>
            <canvas ref={canvas} class={styles.canvas} data-paper-no-swipe-back classList={{ [styles.grabbing]: grabbing() }} />

            <div class={styles.controls}>
                <div class={styles.selects}>
                    <Show when={availableDimensions().length > 1}>
                        <PaperFlex minWidth="field">
                            <PaperSelectMenu
                                name="mapDimension"
                                value={dimension()}
                                onValueChange={(val) =>
                                    switchDimension(String(val) as MapDimension)
                                }
                            >
                                <For each={availableDimensions()}>
                                    {(dim) => (
                                        <PaperSelectMenuItem value={dim}>
                                            {DIMENSION_LABELS[dim]}
                                        </PaperSelectMenuItem>
                                    )}
                                </For>
                            </PaperSelectMenu>
                        </PaperFlex>
                    </Show>
                    <Show when={playerKeys().length > 0}>
                        <PaperFlex minWidth="field">
                            <PaperSelectMenu
                                name="mapPlayer"
                                value={selectedPlayer()}
                                onValueChange={(val) => goToPlayer(String(val))}
                            >
                                <For each={playerKeys()}>
                                    {(name) => (
                                        <PaperSelectMenuItem value={name}>
                                            {name}
                                        </PaperSelectMenuItem>
                                    )}
                                </For>
                            </PaperSelectMenu>
                        </PaperFlex>
                    </Show>
                </div>

                <div class={[styles.glass, styles.coords].join(" ")}>
                    <PaperIcon>my_location</PaperIcon>
                    <PaperText size={2} color="text-subtle">
                        {Math.round((cursor() ?? centerCoords()).x)},{" "}
                        {Math.round((cursor() ?? centerCoords()).z)}
                    </PaperText>
                    <Show when={store.pendingCount() > 0}>
                        <PaperIcon>hourglass_top</PaperIcon>
                        <PaperText size={2} color="text-subtle">
                            {store.pendingCount()}
                        </PaperText>
                    </Show>
                    <PaperFlex flex minWidth={0}>
                        <PaperInput
                            placeholder="X"
                            size={9}
                            value={coordX()}
                            error={coordX().trim() !== "" && coordinate(coordX()) === null ? "Numbers only" : undefined}
                            onInput={(e) => setCoordX(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") goToCoords();
                            }}
                        />
                    </PaperFlex>
                    <PaperFlex flex minWidth={0}>
                        <PaperInput
                            placeholder="Z"
                            size={9}
                            value={coordZ()}
                            error={coordZ().trim() !== "" && coordinate(coordZ()) === null ? "Numbers only" : undefined}
                            onInput={(e) => setCoordZ(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") goToCoords();
                            }}
                        />
                    </PaperFlex>
                    <PaperButton size="tiny" onClick={goToCoords}>
                        Go
                    </PaperButton>
                </div>
            </div>

            <Show when={unexplored() || (info() && regionsError())}>
                <PaperFlex class={styles.bottomLeft} direction="column" gap="half">
                    {/* a listing again that failed leaves the map drawn as it was, under why */}
                    <Show when={info() && regionsError()}>
                        {(err) => (
                            <PaperError
                                class={styles.overMap}
                                title="Couldn't read the world's region files"
                                error={err()}
                                action={{ label: "Try again", onClick: () => void loadRegions() }}
                            />
                        )}
                    </Show>
                    <Show when={unexplored()}>
                        <PaperQuote variant="primary" icon="explore" title="Only the land around spawn so far" onDismiss={() => setExplained(true)}>
                            Nobody has played on this world yet, so the server has saved only the area where players start. The map fills in as players explore, each time the server saves the world.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </Show>

            <Show when={!info() && regionsError()}>
                {(err) => (
                    <div class={styles.empty}>
                        <PaperError
                            fill
                            title="Couldn't read the world's region files"
                            error={err()}
                            action={{ label: "Try again", onClick: () => void loadRegions() }}
                        />
                    </div>
                )}
            </Show>

            <Show
                when={
                    info() &&
                    (info()!.dimensions?.length ?? 0) === 0 &&
                    !regionsError()
                }
            >
                <div class={styles.empty}>
                    <PaperText size={3} color="text-subtle">
                        No generated terrain to map yet. Start the server once.
                    </PaperText>
                </div>
            </Show>
        </div>
    );
}
