import { contactBetween, containsPoint, hullFromAlpha, worldHull, type Point } from "./geometry";

// Paper icons you can fling: ported from paperdocs' landing playground
// (public/js/icon-play.js). Icons scatter around the copy, tossed ones
// bounce off the edges and each other by their visible silhouettes, and a
// tap spins one in place. Everything it starts, stop() ends.

const DAMPING = 0.996;
const RESTITUTION = 0.94;
const STOP_SPEED = 2.5;
const ANG_DAMPING = 0.993;
const ANG_STOP = 0.02;
const MAX_TILT = 0.5;
const MAX_SPEED = 1800;
const CANDIDATES = 128;
/** px/s an icon must hit something at to be felt */
const IMPACT_SPEED = 700;
/** collision silhouettes are sampled at this many px square */
const SAMPLE = 48;

export interface IconPlayOptions {
    /** px each icon is drawn at */
    size: number;
    /** what icons are scattered around rather than over */
    avoid: () => Element[];
    /** no tossing or spinning: icons stay where they're put */
    reduceMotion: boolean;
    /** an icon hit an edge or another icon hard */
    onImpact?: () => void;
    /** a tap, not a drag, on an icon */
    onTap?: () => void;
}

interface Item {
    el: HTMLElement;
    size: number;
    hull: Point[];
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    av: number;
    dragging: boolean;
    pointerId: number | null;
    grabX: number;
    grabY: number;
    lastT: number;
    moved: boolean;
    downX: number;
    downY: number;
}

async function silhouette(icon: HTMLImageElement, size: number): Promise<Point[]> {
    await icon.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SAMPLE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Icon collision canvas unavailable");
    const scale = Math.min(SAMPLE / icon.naturalWidth, SAMPLE / icon.naturalHeight);
    const width = icon.naturalWidth * scale;
    const height = icon.naturalHeight * scale;
    context.drawImage(icon, (SAMPLE - width) / 2, (SAMPLE - height) / 2, width, height);
    return hullFromAlpha(context.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, SAMPLE, size);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Starts the playground; `ready` settles once the icons are placed (or rejects if they can't be). */
export function createIconPlay(field: HTMLElement, icons: HTMLImageElement[], opts: IconPlayOptions): { ready: Promise<void>; stop: () => void } {
    const items: Item[] = [];
    let W = 0;
    let H = 0;
    let running = false;
    let stopped = false;
    let raf = 0;
    let last = 0;
    let resize: ResizeObserver | undefined;

    const measure = () => {
        const rect = field.getBoundingClientRect();
        W = rect.width;
        H = rect.height;
    };

    // resting lean follows position: a gentle swirl rather than all one way
    const tiltFor = (item: Item) => {
        const travel = Math.max(1, W - item.size);
        const nx = (item.x / travel) * 2 - 1;
        const bottom = item.y + item.size / 2 > H / 2;
        return (bottom ? -1 : 1) * nx * MAX_TILT;
    };

    const setTransform = (item: Item) => {
        item.el.style.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, 0) rotate(${item.angle.toFixed(3)}rad)`;
    };

    const atRest = (item: Item) =>
        !item.dragging && !item.vx && !item.vy && !item.av && Math.abs(item.angle - tiltFor(item)) < 0.002;

    // bands around what icons must clear, inset from the field's edges
    const bands = () => {
        const size = opts.size;
        const inset = Math.min(size * 0.3, W * 0.05, H * 0.05);
        const fieldRect = field.getBoundingClientRect();
        const rects = opts.avoid().map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
        const margin = 16;
        let ex = { x: W * 0.19, y: H * 0.3, w: W * 0.62, h: H * 0.4 };
        if (rects.length) {
            const left = Math.min(...rects.map((r) => r.left)) - fieldRect.left - margin;
            const top = Math.min(...rects.map((r) => r.top)) - fieldRect.top - margin;
            const right = Math.max(...rects.map((r) => r.right)) - fieldRect.left + margin;
            const bottom = Math.max(...rects.map((r) => r.bottom)) - fieldRect.top + margin;
            ex = { x: Math.max(0, left), y: Math.max(0, top), w: Math.min(W, right) - Math.max(0, left), h: Math.min(H, bottom) - Math.max(0, top) };
        }
        return [
            { x: inset, y: inset, w: W - inset * 2, h: ex.y - inset },
            { x: inset, y: ex.y + ex.h, w: W - inset * 2, h: H - inset - (ex.y + ex.h) },
            { x: inset, y: ex.y, w: ex.x - inset, h: ex.h },
            { x: ex.x + ex.w, y: ex.y, w: W - inset - (ex.x + ex.w), h: ex.h },
        ].filter((band) => band.w >= size && band.h >= size);
    };

    const scatter = (shapes: Point[][]) => {
        measure();
        const regions = bands();
        const placed: Point[] = [];
        icons.forEach((el, index) => {
            const item: Item = {
                el, size: opts.size, hull: shapes[index], x: 0, y: 0, vx: 0, vy: 0, angle: 0, av: 0,
                dragging: false, pointerId: null, grabX: 0, grabY: 0, lastT: 0, moved: false, downX: 0, downY: 0,
            };
            // best candidate: the sample furthest from everything placed
            let best = { x: 0, y: 0 };
            let bestDistance = -1;
            for (let attempt = 0; attempt < CANDIDATES; attempt++) {
                const band = regions.length ? regions[Math.floor(Math.random() * regions.length)] : { x: 0, y: 0, w: W, h: H };
                const candidate = { x: band.x + Math.random() * Math.max(0, band.w - item.size), y: band.y + Math.random() * Math.max(0, band.h - item.size) };
                let nearest = Infinity;
                for (const other of placed) nearest = Math.min(nearest, Math.hypot(candidate.x - other.x, candidate.y - other.y));
                if (nearest > bestDistance) {
                    bestDistance = nearest;
                    best = candidate;
                }
            }
            item.x = best.x;
            item.y = best.y;
            item.angle = tiltFor(item);
            placed.push(best);
            items.push(item);
            setTransform(item);
        });
    };

    const clampItem = (item: Item) => {
        item.x = clamp(item.x, 0, Math.max(0, W - item.size));
        item.y = clamp(item.y, 0, Math.max(0, H - item.size));
    };

    const clampAll = () => {
        measure();
        for (const item of items) {
            clampItem(item);
            setTransform(item);
        }
    };

    const integrate = (item: Item, dt: number) => {
        if (item.vx !== 0 || item.vy !== 0) {
            item.x += item.vx * dt;
            item.y += item.vy * dt;
            const maxX = Math.max(0, W - item.size);
            const maxY = Math.max(0, H - item.size);
            let hit = 0;
            if (item.x <= 0 || item.x >= maxX) {
                hit = Math.abs(item.vx);
                item.vx = (item.x <= 0 ? 1 : -1) * Math.abs(item.vx) * RESTITUTION;
                item.x = item.x <= 0 ? 0 : maxX;
            }
            if (item.y <= 0 || item.y >= maxY) {
                hit = Math.max(hit, Math.abs(item.vy));
                item.vy = (item.y <= 0 ? 1 : -1) * Math.abs(item.vy) * RESTITUTION;
                item.y = item.y <= 0 ? 0 : maxY;
            }
            if (hit > IMPACT_SPEED) opts.onImpact?.();
            item.vx *= DAMPING;
            item.vy *= DAMPING;
            if (Math.hypot(item.vx, item.vy) < STOP_SPEED) {
                item.vx = 0;
                item.vy = 0;
            }
        }
        if (item.av !== 0) {
            item.angle += item.av * dt;
            item.av *= ANG_DAMPING;
            if (Math.abs(item.av) < ANG_STOP) item.av = 0;
        } else {
            // settle back to the position-matched lean, never upside down
            const tilt = tiltFor(item);
            item.angle += (tilt - item.angle) * 0.08;
            if (Math.abs(tilt - item.angle) < 0.002) item.angle = tilt;
        }
    };

    // contacts follow each silhouette and its rotation; a dragged icon is
    // infinite mass and shoves its neighbour
    const collide = () => {
        for (let i = 0; i < items.length; i++) {
            const a = items[i];
            for (let j = i + 1; j < items.length; j++) {
                const b = items[j];
                if (a.dragging && b.dragging) continue;
                const contact = contactBetween(worldHull(a), worldHull(b));
                if (!contact) continue;
                const { nx, ny, overlap } = contact;
                const aShare = a.dragging ? 0 : b.dragging ? 1 : 0.5;
                const bShare = b.dragging ? 0 : a.dragging ? 1 : 0.5;
                a.x -= nx * overlap * aShare;
                a.y -= ny * overlap * aShare;
                b.x += nx * overlap * bShare;
                b.y += ny * overlap * bShare;
                const rvx = b.vx - a.vx;
                const rvy = b.vy - a.vy;
                const vn = rvx * nx + rvy * ny;
                if (vn > 0) continue;
                const invA = a.dragging ? 0 : 1;
                const invB = b.dragging ? 0 : 1;
                const invSum = invA + invB;
                if (invSum === 0) continue;
                if (-vn > IMPACT_SPEED) opts.onImpact?.();
                const impulse = (-(1 + RESTITUTION) * vn) / invSum;
                a.vx -= impulse * nx * invA;
                a.vy -= impulse * ny * invA;
                b.vx += impulse * nx * invB;
                b.vy += impulse * ny * invB;
                const vt = rvx * -ny + rvy * nx;
                if (invA) a.av -= vt * 0.004;
                if (invB) b.av += vt * 0.004;
                for (const item of [invA ? a : null, invB ? b : null]) {
                    if (!item) continue;
                    const speed = Math.hypot(item.vx, item.vy);
                    if (speed > MAX_SPEED) {
                        item.vx *= MAX_SPEED / speed;
                        item.vy *= MAX_SPEED / speed;
                    }
                }
            }
        }
    };

    const step = (now: number) => {
        const dt = last ? Math.min(0.033, (now - last) / 1000) : 0.016;
        last = now;
        let moving = false;
        for (const item of items) {
            if (item.dragging) moving = true;
            else integrate(item, dt);
        }
        collide();
        for (const item of items) {
            clampItem(item);
            if (!atRest(item)) moving = true;
            setTransform(item);
        }
        if (moving && !stopped) raf = requestAnimationFrame(step);
        else running = false;
    };

    const start = () => {
        if (running || stopped) return;
        running = true;
        last = 0;
        raf = requestAnimationFrame(step);
    };

    const spin = (item: Item, strength: number) => {
        item.av = (Math.random() < 0.5 ? -1 : 1) * strength;
        start();
    };

    const onPointerDown = (event: PointerEvent) => {
        const item = items.find((candidate) => candidate.el === event.currentTarget);
        if (!item) return;
        const rect = field.getBoundingClientRect();
        // the transparent corners aren't the icon
        if (!containsPoint(worldHull(item), event.clientX - rect.left, event.clientY - rect.top)) return;
        event.preventDefault();
        item.dragging = true;
        item.pointerId = event.pointerId;
        item.grabX = event.clientX - rect.left - item.x;
        item.grabY = event.clientY - rect.top - item.y;
        item.lastT = event.timeStamp;
        item.downX = event.clientX;
        item.downY = event.clientY;
        item.moved = false;
        item.vx = 0;
        item.vy = 0;
        if (item.el.isConnected) item.el.setPointerCapture(event.pointerId);
        item.el.dataset.dragging = "";
        start();
    };

    const onPointerMove = (event: PointerEvent) => {
        const item = items.find((candidate) => candidate.dragging && candidate.pointerId === event.pointerId);
        if (!item) return;
        if (Math.hypot(event.clientX - item.downX, event.clientY - item.downY) > 4) item.moved = true;
        const rect = field.getBoundingClientRect();
        const nextX = clamp(event.clientX - rect.left - item.grabX, 0, Math.max(0, W - item.size));
        const nextY = clamp(event.clientY - rect.top - item.grabY, 0, Math.max(0, H - item.size));
        const dt = Math.max(0.008, (event.timeStamp - item.lastT) / 1000);
        item.vx = clamp((nextX - item.x) / dt, -MAX_SPEED, MAX_SPEED);
        item.vy = clamp((nextY - item.y) / dt, -MAX_SPEED, MAX_SPEED);
        item.x = nextX;
        item.y = nextY;
        item.lastT = event.timeStamp;
        setTransform(item);
    };

    const onPointerUp = (event: PointerEvent) => {
        const item = items.find((candidate) => candidate.dragging && candidate.pointerId === event.pointerId);
        if (!item) return;
        item.dragging = false;
        item.pointerId = null;
        delete item.el.dataset.dragging;
        if (item.el.hasPointerCapture(event.pointerId)) item.el.releasePointerCapture(event.pointerId);
        if (event.type === "pointercancel") {
            // the browser took the touch: the icon stays where it was let go
            item.vx = 0;
            item.vy = 0;
            return;
        }
        if (!item.moved) {
            // a tap, not a drag: a playful spin in place
            item.vx = 0;
            item.vy = 0;
            opts.onTap?.();
            if (!opts.reduceMotion) spin(item, 3 + Math.random() * 4);
            return;
        }
        const speed = Math.hypot(item.vx, item.vy);
        if (speed > MAX_SPEED) {
            item.vx *= MAX_SPEED / speed;
            item.vy *= MAX_SPEED / speed;
        }
        if (opts.reduceMotion) {
            item.vx = 0;
            item.vy = 0;
            return;
        }
        spin(item, clamp(speed / 220, 1, 8));
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        running = false;
        cancelAnimationFrame(raf);
        resize?.disconnect();
        for (const icon of icons) icon.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
    };

    const ready = Promise.all(icons.map((icon) => silhouette(icon, opts.size))).then((shapes) => {
        if (stopped) return;
        scatter(shapes);
        for (const icon of icons) icon.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        resize = new ResizeObserver(clampAll);
        resize.observe(field);
        start();
    });

    return { ready, stop };
}
