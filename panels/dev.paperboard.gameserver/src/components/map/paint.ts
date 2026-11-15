// Paints the map's canvas: the dimension's tiles at the view's scale and
// offset, then a marker and a name for every player in that dimension.
import { getVar } from "@mileniumhq/paperui";
import { REGION_BLOCKS, type MapDimension } from "../../core/map";
import type { PlayerPosition } from "../../core/players";
import type { TileState } from "./tiles";

// a marker's side in CSS px: its base at scale 1, never under the min or over the max
const MARKER_SIZE = { base: 22, min: 18, max: 30 };
const MARKER_OUTLINE = 2;

export interface MapViewport {
    /** the canvas's size in CSS px */
    width: number;
    height: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    dimension: MapDimension;
}

// a canvas takes values, not var() strings; a token that isn't defined is a
// broken stylesheet, not a reason to guess
function token(name: string): string {
    const value = getVar(name);
    if (!value) throw new Error(`PaperUI token --paper-${name} is not defined`);
    return value;
}

/** Throws when the canvas can't be drawn on, or a token it paints with is missing. */
export function paintMap(
    canvas: HTMLCanvasElement,
    view: MapViewport,
    tiles: ReadonlyMap<string, TileState>,
    positions: ReadonlyMap<string, PlayerPosition>,
    head: (name: string) => HTMLImageElement | null,
): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The map's canvas has no 2D context");
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    const size = REGION_BLOCKS * view.scale;
    for (const [key, tile] of tiles) {
        const [tileDim, rx, rz] = key.split(":");
        if (tileDim !== view.dimension) continue;
        ctx.drawImage(tile.image, Number(rx) * size + view.offsetX, Number(rz) * size + view.offsetY, size, size);
    }
    paintPlayers(ctx, view, positions, head);
}

function paintPlayers(
    ctx: CanvasRenderingContext2D,
    view: MapViewport,
    positions: ReadonlyMap<string, PlayerPosition>,
    head: (name: string) => HTMLImageElement | null,
) {
    const s = view.scale;
    const size = Math.max(MARKER_SIZE.min, Math.min(MARKER_SIZE.max, MARKER_SIZE.base * Math.max(0.8, s)));
    // colors and type come from the token set, resolved to values: a
    // canvas ignores a var() string and keeps its previous value
    const strokeColor = token("on-color");
    const markerColor = token("danger");
    const labelBg = token("scrim");
    const labelText = token("on-color");
    const fontSize = token("text-size-1");
    ctx.font = `${token("weight-semibold")} ${fontSize} ${token("font-family")}`;
    ctx.textBaseline = "middle";
    // the label's box: a line and a half tall, padded by a third of the type
    const labelHeight = parseFloat(fontSize) * 1.5;
    const labelPad = parseFloat(fontSize) / 3;
    for (const [key, pos] of positions) {
        if (pos.dimension !== `minecraft:${view.dimension}`) continue;
        const screenX = pos.x * s + view.offsetX;
        const screenY = pos.z * s + view.offsetY;
        const picture = head(key);
        ctx.lineWidth = MARKER_OUTLINE;
        ctx.strokeStyle = strokeColor;
        if (picture) {
            ctx.drawImage(picture, screenX - size / 2, screenY - size / 2, size, size);
            ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
        } else {
            ctx.beginPath();
            ctx.arc(screenX, screenY, size / 3, 0, Math.PI * 2);
            ctx.fillStyle = markerColor;
            ctx.fill();
            ctx.stroke();
        }
        const labelX = screenX + size / 2 + labelPad;
        ctx.fillStyle = labelBg;
        ctx.fillRect(labelX, screenY - labelHeight / 2, ctx.measureText(key).width + labelPad * 2, labelHeight);
        ctx.fillStyle = labelText;
        ctx.fillText(key, labelX + labelPad, screenY);
    }
}
