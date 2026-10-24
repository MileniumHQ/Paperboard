// Convex silhouettes from an icon's visible pixels, and contacts between
// them: ported from paperdocs' icon playground (public/js/icon-geometry.mjs).
// Samples are bounded by the caller; faint painted shadows stay outside the
// physical shape.

export interface Point {
    x: number;
    y: number;
}

export interface Placed {
    hull: Point[];
    x: number;
    y: number;
    size: number;
    angle: number;
}

export function hullFromAlpha(data: ArrayLike<number>, width: number, height: number, size: number, threshold = 96): Point[] {
    const points: Point[] = [];
    for (let y = 0; y < height; y++) {
        let first = width;
        let last = -1;
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= threshold) {
                first = Math.min(first, x);
                last = x;
            }
        }
        if (last < 0) continue;
        for (const x of [first, last + 1])
            for (const row of [y, y + 1]) points.push({ x: (x / width) * size - size / 2, y: (row / height) * size - size / 2 });
    }
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const unique = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    if (unique.length < 3) throw new Error("Icon has no visible collision silhouette");
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const half = (ordered: Point[]) => {
        const result: Point[] = [];
        for (const point of ordered) {
            while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop();
            result.push(point);
        }
        return result;
    };
    const lower = half(unique);
    const upper = half([...unique].reverse());
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

export function worldHull(item: Placed): Point[] {
    const c = Math.cos(item.angle);
    const s = Math.sin(item.angle);
    return item.hull.map((p) => ({ x: item.x + item.size / 2 + p.x * c - p.y * s, y: item.y + item.size / 2 + p.x * s + p.y * c }));
}

export function containsPoint(hull: Point[], x: number, y: number): boolean {
    return hull.every((a, i) => {
        const b = hull[(i + 1) % hull.length];
        return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= -0.001;
    });
}

/** Separating axes: the contact normal and minimum translation, or null when apart. */
export function contactBetween(a: Point[], b: Point[]): { nx: number; ny: number; overlap: number } | null {
    let depth = Infinity;
    let normal: { nx: number; ny: number } | undefined;
    const centre = (polygon: Point[]) => ({
        x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
        y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
    });
    const ca = centre(a);
    const cb = centre(b);
    for (const polygon of [a, b]) {
        for (let i = 0; i < polygon.length; i++) {
            const p = polygon[i];
            const q = polygon[(i + 1) % polygon.length];
            const length = Math.hypot(q.x - p.x, q.y - p.y);
            if (!length) continue;
            let nx = -(q.y - p.y) / length;
            let ny = (q.x - p.x) / length;
            if ((cb.x - ca.x) * nx + (cb.y - ca.y) * ny < 0) {
                nx = -nx;
                ny = -ny;
            }
            const pa = a.map((v) => v.x * nx + v.y * ny);
            const pb = b.map((v) => v.x * nx + v.y * ny);
            const minA = Math.min(...pa);
            const maxA = Math.max(...pa);
            const minB = Math.min(...pb);
            const maxB = Math.max(...pb);
            if (maxA <= minB || maxB <= minA) return null;
            const overlap = Math.min(maxA - minB, maxB - minA);
            if (overlap < depth) {
                depth = overlap;
                normal = { nx, ny };
            }
        }
    }
    return normal ? { ...normal, overlap: depth } : null;
}
