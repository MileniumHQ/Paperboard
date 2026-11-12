import {
    createEffect,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    getVar,
} from "@mileniumhq/paperui";
import {
    listMapRegions,
    renderMapTile,
    type MapDimensionRegions,
    type MapRegionsResult,
} from "../lib/map";
import {
    DIMENSION_LABELS,
    REGION_BLOCKS,
    type MapDimension,
} from "../core/map";
import {
    onlinePlayerNames,
    playerPositions,
    queryPlayerPositions,
    seenPlayerNames,
    serverStatus,
} from "../lib/server";
import { loadHead } from "../lib/skins";
import styles from "./Map.module.css";
import { errorMessage, type Outcome } from "../lib/failure";

const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.2;
// how much of the map the terrain fills when it opens
const TERRAIN_FILL = 0.8;
const POSITION_POLL_MS = 2000;
// a region file changes when the server saves the world, minutes apart
const TILE_REFRESH_MS = 30_000;
// the service paints one region at a time; asking for a whole world at once
// only queues work for tiles the view may have left by the time they paint
const MAX_TILE_REQUESTS = 2;
// new regions appear while the server generates; re-list on a slower clock
// so the map can show terrain beyond what existed when the tab opened
const REGION_REFRESH_MS = 15000;
// decoded tiles held in the renderer; panning across a world must not grow
// memory without a bound
const MAX_TILE_CACHE = 256;

interface TileState {
    image: HTMLImageElement;
    /** the region file's version this image was painted from */
    version: number;
    /** the refresh tick that last asked the service about it */
    checked: number;
}

// Full-bleed top-down world map: region tiles rendered by the service,
// online players drawn as markers, per-dimension. Pans by drag, zooms on
// the cursor, pinches on touch, and refreshes both tiles and positions on its own.
export default function MapView() {
    const [info, setInfo] = createSignal<MapRegionsResult | null>(null);
    const [error, setError] = createSignal<Outcome | null>(null);
    const [dimension, setDimension] = createSignal<MapDimension>("overworld");
    const [pendingCount, setPendingCount] = createSignal(0);
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
    const tiles = new Map<string, TileState>();
    const pending = new Set<string>();
    const headImages = new Map<string, HTMLImageElement>();

    // player heads are composited from Mojang by the service (the browser
    // cannot read the profile endpoint across origins). Loaded lazily; until
    // they arrive markers draw as dots, and a load triggers a redraw.
    const getHead = (name: string): HTMLImageElement | null => {
        const key = name.toLowerCase();
        const existing = headImages.get(key);
        if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;
        // reserve the slot so a redraw does not start a second lookup
        headImages.set(key, new Image());
        void loadHead({ name })
            .then((dataUrl) => {
                if (!dataUrl) {
                    console.debug(`[Map] no head image for ${name}`);
                    return;
                }
                const image = new Image();
                image.onload = () => {
                    headImages.set(key, image);
                    setRevision((v) => v + 1);
                };
                image.onerror = () => console.error(`[Map] head decode failed for ${name}`);
                image.src = dataUrl;
            })
            .catch((err) => console.error(`[Map] head lookup failed for ${name}:`, String(err)));
        return null;
    };

    const keyOf = (dim: MapDimension, rx: number, rz: number) => `${dim}:${rx}:${rz}`;

    const availableDimensions = () => info()?.dimensions?.map((d) => d.dimension) ?? [];
    const regionsFor = (dim: MapDimension) =>
        info()?.dimensions?.find((d) => d.dimension === dim)?.regions ?? [];
    const playerKeys = () =>
        Array.from(new Set([...seenPlayerNames(), ...onlinePlayerNames()])).sort();

    // the tiles the view still wants, nearest its centre first
    let wanted: { dim: MapDimension; rx: number; rz: number }[] = [];
    const requestWanted = () => {
        while (pending.size < MAX_TILE_REQUESTS) {
            const next = wanted.shift();
            if (!next) return;
            requestTile(next.dim, next.rx, next.rz);
        }
    };

    const requestTile = (dim: MapDimension, rx: number, rz: number) => {
        const key = keyOf(dim, rx, rz);
        const existing = tiles.get(key);
        if (pending.has(key)) return;
        pending.add(key);
        setPendingCount(pending.size);
        const asked = tileRefresh();
        // a tile already drawn is only asked whether it changed
        renderMapTile(dim, rx, rz, existing?.version)
            .then((result) => {
                pending.delete(key);
                setPendingCount(pending.size);
                requestWanted();
                if (existing) existing.checked = asked;
                const dataUrl = result?.dataUrl;
                if (!result || !dataUrl) return;
                const image = new Image();
                image.onload = () => {
                    tiles.delete(key);
                    tiles.set(key, { image, version: result.version, checked: asked });
                    while (tiles.size > MAX_TILE_CACHE) {
                        const oldest = tiles.keys().next().value;
                        if (oldest === undefined) break;
                        tiles.delete(oldest);
                    }
                    setRevision((v) => v + 1);
                };
                image.onerror = () => {
                    console.error(`[Map] tile image decode failed for ${key}`);
                };
                image.src = dataUrl;
            })
            .catch((err) => {
                pending.delete(key);
                setPendingCount(pending.size);
                requestWanted();
                console.error(`[Map] Failed to render tile ${key}:`, err);
                setError({ title: "A map tile didn't render", message: errorMessage(err) });
            });
    };

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
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { width, height } = sizeOf();
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const s = scale();
        const size = REGION_BLOCKS * s;
        const dim = dimension();
        for (const [key, tile] of tiles) {
            const [tileDim, rx, rz] = key.split(":");
            if (tileDim !== dim) continue;
            ctx.drawImage(
                tile.image,
                Number(rx) * REGION_BLOCKS * s + offsetX(),
                Number(rz) * REGION_BLOCKS * s + offsetY(),
                size,
                size,
            );
        }
        drawPlayers(ctx);
    };

    const drawPlayers = (ctx: CanvasRenderingContext2D) => {
        const s = scale();
        const dim = dimension();
        const size = Math.max(18, Math.min(30, 22 * Math.max(0.8, s)));
        // colors come from the token set, resolved to values: a canvas
        // ignores a var() string and keeps its previous colour
        const strokeColor = getVar("on-color");
        const markerColor = getVar("danger");
        const labelBg = getVar("scrim");
        const labelText = getVar("on-color");
        for (const [key, pos] of playerPositions()) {
            if (pos.dimension !== `minecraft:${dim}`) continue;
            const screenX = pos.x * s + offsetX();
            const screenY = pos.z * s + offsetY();
            const head = getHead(key);
            if (head) {
                ctx.drawImage(head, screenX - size / 2, screenY - size / 2, size, size);
                ctx.lineWidth = 2;
                ctx.strokeStyle = strokeColor;
                ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
            } else {
                ctx.beginPath();
                ctx.arc(screenX, screenY, Math.max(4, size / 3), 0, Math.PI * 2);
                ctx.fillStyle = markerColor;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = strokeColor;
                ctx.stroke();
            }
            const label = key;
            ctx.font = `600 ${getVar("text-size-1", "12px")} system-ui, sans-serif`;
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = labelBg;
            ctx.fillRect(screenX + size / 2 + 3, screenY - 9, textWidth + 8, 18);
            ctx.fillStyle = labelText;
            ctx.fillText(label, screenX + size / 2 + 7, screenY + 4);
        }
    };

    const centerOnWorld = (x: number, z: number) => {
        const { width, height } = sizeOf();
        setOffsetX(width / 2 - x * scale());
        setOffsetY(height / 2 - z * scale());
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

    const goToCoords = () => {
        const x = Number(coordX().trim());
        const z = Number(coordZ().trim());
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        centerOnWorld(x, z);
    };

    // the whole generated terrain in view, with a margin: a new world's few
    // chunks fill the map instead of sitting small in a corner of their region
    const fitTerrain = (terrain: MapDimensionRegions["terrain"]) => {
        const { width, height } = sizeOf();
        const fit = Math.min(width / (terrain.maxX - terrain.minX), height / (terrain.maxZ - terrain.minZ)) * TERRAIN_FILL;
        setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit)));
        centerOnWorld((terrain.minX + terrain.maxX) / 2, (terrain.minZ + terrain.maxZ) / 2);
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
            const result = await listMapRegions();
            setInfo(result);
            setError(null);
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
            console.error("[Map] Failed to list regions:", err);
            setError({ title: "Couldn't read the world's region files", message: errorMessage(err) });
        }
    };

    onMount(() => {
        const resize = () => {
            if (!canvas || !wrapper) return;
            // a phone's screen has more pixels than CSS px; drawing at 1:1 would blur
            canvas.width = Math.round(wrapper.clientWidth * devicePixelRatio);
            canvas.height = Math.round(wrapper.clientHeight * devicePixelRatio);
            setRevision((v) => v + 1);
        };
        resize();
        const observer = new ResizeObserver(resize);
        if (wrapper) observer.observe(wrapper);

        // every finger (or the mouse) on the map, by pointer id: one pans, two pinch
        const touches = new Map<number, { x: number; y: number }>();

        const worldAt = (clientX: number, clientY: number) => {
            const rect = canvas?.getBoundingClientRect();
            if (!rect) return null;
            const s = scale();
            if (!s) return null;
            return {
                x: (clientX - rect.left - offsetX()) / s,
                z: (clientY - rect.top - offsetY()) / s,
            };
        };

        // zooms to `next`, keeping the world point under (mouseX, mouseY) where it is
        const zoomAt = (mouseX: number, mouseY: number, next: number) => {
            const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
            const worldX = (mouseX - offsetX()) / scale();
            const worldY = (mouseY - offsetY()) / scale();
            setScale(clamped);
            setOffsetX(mouseX - worldX * clamped);
            setOffsetY(mouseY - worldY * clamped);
        };

        // the two fingers' midpoint (relative to the map) and their distance
        const pinchOf = () => {
            const rect = canvas?.getBoundingClientRect();
            const [a, b] = [...touches.values()];
            if (!rect || !a || !b) return null;
            return {
                x: (a.x + b.x) / 2 - rect.left,
                y: (a.y + b.y) / 2 - rect.top,
                distance: Math.hypot(a.x - b.x, a.y - b.y),
            };
        };

        const onPointerDown = (e: PointerEvent) => {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            setGrabbing(true);
            canvas?.setPointerCapture(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            setCursor(worldAt(e.clientX, e.clientY));
            const before = touches.get(e.pointerId);
            if (!before) return;
            if (touches.size >= 2) {
                const start = pinchOf();
                touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
                const now = pinchOf();
                if (!start || !now || start.distance === 0) return;
                // the fingers' midpoint pans, their spread zooms around it
                setOffsetX((v) => v + (now.x - start.x));
                setOffsetY((v) => v + (now.y - start.y));
                zoomAt(now.x, now.y, scale() * (now.distance / start.distance));
                return;
            }
            setOffsetX((v) => v + (e.clientX - before.x));
            setOffsetY((v) => v + (e.clientY - before.y));
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        };
        const onPointerUp = (e: PointerEvent) => {
            touches.delete(e.pointerId);
            setGrabbing(touches.size > 0);
            if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        };
        const onPointerLeave = () => setCursor(null);
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas?.getBoundingClientRect();
            if (!rect) return;
            const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            zoomAt(e.clientX - rect.left, e.clientY - rect.top, scale() * factor);
        };

        canvas?.addEventListener("pointerdown", onPointerDown);
        canvas?.addEventListener("pointermove", onPointerMove);
        canvas?.addEventListener("pointerup", onPointerUp);
        canvas?.addEventListener("pointercancel", onPointerUp);
        canvas?.addEventListener("pointerleave", onPointerLeave);
        canvas?.addEventListener("wheel", onWheel, { passive: false });

        const positionPoll = setInterval(() => {
            if (serverStatus() === "online") queryPlayerPositions();
        }, POSITION_POLL_MS);
        const tilePoll = setInterval(
            () => setTileRefresh((v) => v + 1),
            TILE_REFRESH_MS,
        );
        // regions generated since mount become visible without a reload
        const regionPoll = setInterval(() => void loadRegions(), REGION_REFRESH_MS);

        onCleanup(() => {
            observer.disconnect();
            clearInterval(positionPoll);
            clearInterval(tilePoll);
            clearInterval(regionPoll);
            canvas?.removeEventListener("pointerdown", onPointerDown);
            canvas?.removeEventListener("pointermove", onPointerMove);
            canvas?.removeEventListener("pointerup", onPointerUp);
            canvas?.removeEventListener("pointercancel", onPointerUp);
            canvas?.removeEventListener("pointerleave", onPointerLeave);
            canvas?.removeEventListener("wheel", onWheel);
        });

        void loadRegions();
    });

    // fetch newly visible tiles only when the view/dimension/refresh clock
    // changes — NOT on every position tick, so markers don't spam the service
    createEffect(() => {
        revision();
        tileRefresh();
        scale();
        offsetX();
        offsetY();
        info();
        dimension();
        const dim = dimension();
        const refresh = tileRefresh();
        const { width, height } = sizeOf();
        // in region units, like the tiles themselves
        const centerX = (width / 2 - offsetX()) / scale() / REGION_BLOCKS - 0.5;
        const centerZ = (height / 2 - offsetY()) / scale() / REGION_BLOCKS - 0.5;
        const fromCenter = (t: { rx: number; rz: number }) => (t.rx - centerX) ** 2 + (t.rz - centerZ) ** 2;
        wanted = visibleTiles()
            .filter((t) => {
                const key = keyOf(dim, t.rx, t.rz);
                const have = tiles.get(key);
                // a drawn tile is asked about again once per refresh
                return !pending.has(key) && (!have || have.checked !== refresh);
            })
            .sort((a, b) => fromCenter(a) - fromCenter(b))
            .map((t) => ({ dim, rx: t.rx, rz: t.rz }));
        requestWanted();
    });

    // redraw on any view or position change
    createEffect(() => {
        revision();
        tileRefresh();
        scale();
        offsetX();
        offsetY();
        info();
        dimension();
        playerPositions();
        draw();
    });

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
                    <Show when={pendingCount() > 0}>
                        <PaperIcon>hourglass_top</PaperIcon>
                        <PaperText size={2} color="text-subtle">
                            {pendingCount()}
                        </PaperText>
                    </Show>
                    <PaperFlex flex minWidth={0}>
                        <PaperInput
                            placeholder="X"
                            size={9}
                            value={coordX()}
                            invalid={
                                coordX().trim() !== "" && !Number.isFinite(Number(coordX()))
                            }
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
                            invalid={
                                coordZ().trim() !== "" && !Number.isFinite(Number(coordZ()))
                            }
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

            <Show when={error()}>
                {(failure) => (
                    <div class={styles.bottomLeft}>
                        <PaperQuote variant="danger" icon="warning" title={failure().title}>
                            {failure().message}
                        </PaperQuote>
                    </div>
                )}
            </Show>

            <Show
                when={
                    info() &&
                    (info()!.dimensions?.length ?? 0) === 0 &&
                    !error()
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
