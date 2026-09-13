import {
    createEffect,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import {
    PaperIcon,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    getVarCss,
} from "@paperboard-dev/paperui";
import {
    listMapRegions,
    renderMapTile,
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

const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.2;
const POSITION_POLL_MS = 2000;
const TILE_REFRESH_MS = 5000;

interface TileState {
    image: HTMLImageElement;
    src: string;
}

// Full-bleed top-down world map: region tiles rendered by the service,
// online players drawn as markers, per-dimension. Pans by drag, zooms on
// the cursor, and refreshes both tiles and positions on its own.
export default function MapView() {
    const [info, setInfo] = createSignal<MapRegionsResult | null>(null);
    const [error, setError] = createSignal("");
    const [dimension, setDimension] = createSignal<MapDimension>("overworld");
    const [pendingCount, setPendingCount] = createSignal(0);
    const [scale, setScale] = createSignal(1);
    const [offsetX, setOffsetX] = createSignal(0);
    const [offsetY, setOffsetY] = createSignal(0);
    const [revision, setRevision] = createSignal(0);
    const [tileRefresh, setTileRefresh] = createSignal(0);
    const [selectedPlayer, setSelectedPlayer] = createSignal("");

    let canvas: HTMLCanvasElement | undefined;
    let wrapper: HTMLDivElement | undefined;
    const tiles = new Map<string, TileState>();
    const pending = new Set<string>();
    const headImages = new Map<string, HTMLImageElement>();

    // player heads from mc-heads.net (declared in the manifest's network
    // hosts). Loaded lazily; until they arrive markers draw as dots, and a
    // load triggers a redraw.
    const getHead = (name: string): HTMLImageElement | null => {
        const key = name.toLowerCase();
        const existing = headImages.get(key);
        if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;
        const image = new Image();
        image.onload = () => setRevision((v) => v + 1);
        image.onerror = () => {
            // keep the dot fallback; mark as loaded-empty so we don't retry
            console.debug(`[Map] no head image for ${name}`);
        };
        image.src = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`;
        headImages.set(key, image);
        return null;
    };

    const keyOf = (dim: MapDimension, rx: number, rz: number) => `${dim}:${rx}:${rz}`;

    const availableDimensions = () => info()?.dimensions?.map((d) => d.dimension) ?? [];
    const regionsFor = (dim: MapDimension) =>
        info()?.dimensions?.find((d) => d.dimension === dim)?.regions ?? [];
    const playerKeys = () =>
        Array.from(new Set([...seenPlayerNames(), ...onlinePlayerNames()])).sort();

    const requestTile = (dim: MapDimension, rx: number, rz: number) => {
        const key = keyOf(dim, rx, rz);
        const existing = tiles.get(key);
        if (pending.has(key)) return;
        pending.add(key);
        setPendingCount(pending.size);
        renderMapTile(dim, rx, rz)
            .then((result) => {
                pending.delete(key);
                setPendingCount(pending.size);
                if (!result?.dataUrl) return;
                // unchanged bytes → the service returned its cached tile,
                // so don't decode the image again
                if (existing && existing.src === result.dataUrl) return;
                const image = new Image();
                image.onload = () => {
                    tiles.set(key, { image, src: result.dataUrl });
                    setRevision((v) => v + 1);
                };
                image.onerror = () => {
                    console.error(`[Map] tile image decode failed for ${key}`);
                };
                image.src = result.dataUrl;
            })
            .catch((err) => {
                pending.delete(key);
                setPendingCount(pending.size);
                console.error(`[Map] Failed to render tile ${key}:`, err);
                setError("A map tile failed to render. Check the console for details.");
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
        // colors come from the token set, not hardcoded hex
        const strokeColor = getVarCss("over-brand");
        const markerColor = getVarCss("front-red");
        const labelBg = getVarCss("overlay");
        const labelText = getVarCss("over-brand");
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
            ctx.font = "600 12px system-ui, sans-serif";
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

    const centerOnRegion = (rx: number, rz: number) =>
        centerOnWorld((rx + 0.5) * REGION_BLOCKS, (rz + 0.5) * REGION_BLOCKS);

    // switching dimension recentres on that dimension's nearest region, so
    // the Nether/End never open on empty space the overworld was centred on
    const switchDimension = (dim: MapDimension) => {
        setDimension(dim);
        const regions = regionsFor(dim);
        if (regions.length === 0) return;
        const closest = regions.reduce((best, r) =>
            Math.hypot(r.x, r.z) < Math.hypot(best.x, best.z) ? r : best,
        );
        centerOnRegion(closest.x, closest.z);
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
        setError("");
        try {
            const result = await listMapRegions();
            setInfo(result);
            const dims = result.dimensions;
            if (dims.length === 0) return;
            const dim =
                dims.find((d) => d.dimension === "overworld") ?? dims[0];
            setDimension(dim.dimension);
            const closest = dim.regions.reduce((best, r) =>
                Math.hypot(r.x, r.z) < Math.hypot(best.x, best.z) ? r : best,
            );
            centerOnRegion(closest.x, closest.z);
        } catch (err) {
            console.error("[Map] Failed to list regions:", err);
            setError("Could not read the world's region files. Check the console for details.");
        }
    };

    onMount(() => {
        const resize = () => {
            if (!canvas || !wrapper) return;
            canvas.width = wrapper.clientWidth;
            canvas.height = wrapper.clientHeight;
            setRevision((v) => v + 1);
        };
        resize();
        const observer = new ResizeObserver(resize);
        if (wrapper) observer.observe(wrapper);

        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        const onPointerDown = (e: PointerEvent) => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            if (canvas) canvas.style.cursor = "grabbing";
            canvas?.setPointerCapture(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!dragging) return;
            setOffsetX((v) => v + (e.clientX - lastX));
            setOffsetY((v) => v + (e.clientY - lastY));
            lastX = e.clientX;
            lastY = e.clientY;
        };
        const onPointerUp = (e: PointerEvent) => {
            dragging = false;
            if (canvas) canvas.style.cursor = "grab";
            canvas?.releasePointerCapture(e.pointerId);
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas?.getBoundingClientRect();
            if (!rect) return;
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale() * factor));
            const worldX = (mouseX - offsetX()) / scale();
            const worldY = (mouseY - offsetY()) / scale();
            setScale(next);
            setOffsetX(mouseX - worldX * next);
            setOffsetY(mouseY - worldY * next);
        };

        canvas?.addEventListener("pointerdown", onPointerDown);
        canvas?.addEventListener("pointermove", onPointerMove);
        canvas?.addEventListener("pointerup", onPointerUp);
        canvas?.addEventListener("pointercancel", onPointerUp);
        canvas?.addEventListener("wheel", onWheel, { passive: false });

        const positionPoll = setInterval(() => {
            if (serverStatus() === "online") queryPlayerPositions();
        }, POSITION_POLL_MS);
        const tilePoll = setInterval(
            () => setTileRefresh((v) => v + 1),
            TILE_REFRESH_MS,
        );

        onCleanup(() => {
            observer.disconnect();
            clearInterval(positionPoll);
            clearInterval(tilePoll);
            canvas?.removeEventListener("pointerdown", onPointerDown);
            canvas?.removeEventListener("pointermove", onPointerMove);
            canvas?.removeEventListener("pointerup", onPointerUp);
            canvas?.removeEventListener("pointercancel", onPointerUp);
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
        for (const tile of visibleTiles()) requestTile(dimension(), tile.rx, tile.rz);
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
        <div
            ref={wrapper}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: "var(--paper-background-definition)",
            }}
        >
            <canvas
                ref={canvas}
                style={{ display: "block", width: "100%", height: "100%", cursor: "grab" }}
            />

            <div
                style={{
                    position: "absolute",
                    top: "var(--paper-uigap)",
                    left: "var(--paper-uigap)",
                    display: "flex",
                    gap: "var(--paper-uigap-half)",
                    "align-items": "center",
                }}
            >
                <Show when={availableDimensions().length > 1}>
                    <div style={{ "min-width": "9rem" }}>
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
                    </div>
                </Show>
                <Show when={playerKeys().length > 0}>
                    <div style={{ "min-width": "11rem" }}>
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
                    </div>
                </Show>
            </div>

            <Show when={pendingCount() > 0}>
                <div
                    style={{
                        position: "absolute",
                        top: "var(--paper-uigap)",
                        right: "var(--paper-uigap)",
                        display: "flex",
                        "align-items": "center",
                        gap: "var(--paper-uigap-onefourth)",
                        padding: "var(--paper-uigap-half) var(--paper-uigap-threefourths)",
                        "border-radius": "var(--paper-border-radius)",
                        background:
                            "color-mix(in srgb, var(--paper-background-frontest) 72%, transparent)",
                        "backdrop-filter": "var(--paper-blur-medium)",
                        border: "var(--paper-border-width) solid var(--paper-medium-border)",
                    }}
                >
                    <PaperIcon>hourglass_top</PaperIcon>
                    <PaperText size={2} color="light-text">
                        Rendering {pendingCount()} tile{pendingCount() === 1 ? "" : "s"}…
                    </PaperText>
                </div>
            </Show>

            <Show when={error()}>
                <div
                    style={{
                        position: "absolute",
                        bottom: "var(--paper-uigap)",
                        left: "var(--paper-uigap)",
                        "max-width": "26rem",
                    }}
                >
                    <PaperQuote variant="red" icon="warning" title="Error">
                        {error()}
                    </PaperQuote>
                </div>
            </Show>

            <Show
                when={
                    info() &&
                    (info()!.dimensions?.length ?? 0) === 0 &&
                    !error()
                }
            >
                <div
                    style={{
                        position: "absolute",
                        inset: "0",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        "pointer-events": "none",
                    }}
                >
                    <PaperText size={3} color="light-text">
                        No generated terrain to map yet. Start the server once.
                    </PaperText>
                </div>
            </Show>
        </div>
    );
}
