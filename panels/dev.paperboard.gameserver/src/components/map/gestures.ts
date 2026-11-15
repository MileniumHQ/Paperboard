// How the map is moved: one finger (or the mouse) drags it, two pinch it
// around their midpoint, and the wheel zooms on the cursor.
import { batch, type Accessor, type Setter } from "solid-js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.2;

/** a scale the map can be shown at */
export const clampScale = (scale: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

/** where the map is looked at from: screen = world * scale + offset */
export interface MapCamera {
    scale: Accessor<number>;
    offsetX: Accessor<number>;
    offsetY: Accessor<number>;
    setScale: Setter<number>;
    setOffsetX: Setter<number>;
    setOffsetY: Setter<number>;
}

/** Moves `camera` with the pointers on `canvas`; returns what stops it. */
export function attachGestures(
    canvas: HTMLCanvasElement,
    camera: MapCamera,
    report: {
        /** a pointer holds the map */
        grabbing(held: boolean): void;
        /** the world point under the pointer, null once it leaves */
        cursor(at: { x: number; z: number } | null): void;
    },
): () => void {
    // every finger (or the mouse) on the map, by pointer id: one pans, two pinch
    const touches = new Map<number, { x: number; y: number }>();

    const worldAt = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        const s = camera.scale();
        if (!s) return null;
        return { x: (clientX - rect.left - camera.offsetX()) / s, z: (clientY - rect.top - camera.offsetY()) / s };
    };

    // zooms to `next`, keeping the world point under (mouseX, mouseY) where it is
    const zoomAt = (mouseX: number, mouseY: number, next: number) => {
        const clamped = clampScale(next);
        const worldX = (mouseX - camera.offsetX()) / camera.scale();
        const worldY = (mouseY - camera.offsetY()) / camera.scale();
        batch(() => {
            camera.setScale(clamped);
            camera.setOffsetX(mouseX - worldX * clamped);
            camera.setOffsetY(mouseY - worldY * clamped);
        });
    };

    // the two fingers' midpoint (relative to the map) and their distance
    const pinchOf = () => {
        const rect = canvas.getBoundingClientRect();
        const [a, b] = [...touches.values()];
        if (!a || !b) return null;
        return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };

    const onPointerDown = (e: PointerEvent) => {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        report.grabbing(true);
        canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
        report.cursor(worldAt(e.clientX, e.clientY));
        const before = touches.get(e.pointerId);
        if (!before) return;
        if (touches.size >= 2) {
            const start = pinchOf();
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const now = pinchOf();
            if (!start || !now || start.distance === 0) return;
            // the fingers' midpoint pans, their spread zooms around it
            batch(() => {
                camera.setOffsetX((v) => v + (now.x - start.x));
                camera.setOffsetY((v) => v + (now.y - start.y));
                zoomAt(now.x, now.y, camera.scale() * (now.distance / start.distance));
            });
            return;
        }
        batch(() => {
            camera.setOffsetX((v) => v + (e.clientX - before.x));
            camera.setOffsetY((v) => v + (e.clientY - before.y));
        });
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onPointerUp = (e: PointerEvent) => {
        touches.delete(e.pointerId);
        report.grabbing(touches.size > 0);
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onPointerLeave = () => report.cursor(null);
    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, camera.scale() * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("wheel", onWheel);
    };
}
