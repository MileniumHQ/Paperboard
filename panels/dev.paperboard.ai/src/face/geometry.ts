// The face is drawn on a unit sphere. Every feature (eye, mouth) is one
// primitive, a thick curved stroke whose lips can part into an open mouth, so any
// expression can tween into any other by interpolating plain numbers.
//
// Feature coordinates are angular offsets (radians) from the face centre on
// the sphere's surface: u to the face's right, v up. They are wrapped onto
// the sphere with the exponential map and projected orthographically, so a
// face turned toward the rim foreshortens like a real one.

export interface Stroke {
    /** centre, radians from the face centre */
    x: number;
    y: number;
    /** half length along the stroke; 0 draws a dot */
    len: number;
    /** direction of the stroke, degrees counterclockwise from +u */
    angle: number;
    /** curvature as a fraction of len: positive lifts the ends (a smile) */
    bend: number;
    /** stroke thickness, radians */
    width: number;
    /** how far the stroke parts into an open mouth: the top lifts, the bottom drops more */
    open: number;
    /** vertical scale around the centre, 1 = as drawn (blinks squash this) */
    squash: number;
}

export interface Pose {
    eyeL: Stroke;
    eyeR: Stroke;
    mouth: Stroke;
    /** hidden (width 0) unless an expression raises it */
    brow: Stroke;
    /** the hand that comes up to the chin; parked below the face when unused */
    hand: Stroke;
}

export interface Orientation {
    /** degrees; positive turns the face to the viewer's right */
    yaw: number;
    /** degrees; positive tips the face up */
    pitch: number;
    /** degrees; tilts the face around its own centre */
    roll: number;
}

const STROKE_KEYS = ["x", "y", "len", "angle", "bend", "width", "open", "squash"] as const;
export const FEATURES = ["eyeL", "eyeR", "mouth", "brow", "hand"] as const;

export function poseToArray(pose: Pose): number[] {
    return FEATURES.flatMap((f) => STROKE_KEYS.map((k) => pose[f][k]));
}

export function arrayToPose(values: readonly number[]): Pose {
    const pose = {} as Pose;
    FEATURES.forEach((f, fi) => {
        const stroke = {} as Stroke;
        STROKE_KEYS.forEach((k, ki) => (stroke[k] = values[fi * STROKE_KEYS.length + ki]!));
        pose[f] = stroke;
    });
    return pose;
}

type V2 = [number, number];
type V3 = [number, number, number];

const EDGE_STEPS = 18;
const CAP_STEPS = 9;

/** Outline of one stroke in face (u, v) space, before the sphere wrap. */
export function strokeOutline(s: Stroke): V2[] {
    const len = Math.max(0, s.len);
    const half = s.width / 2;
    const centre = (t: number): V2 => [t * len, s.bend * len * t * t];
    const normal = (t: number): V2 => {
        const dx = len;
        const dy = 2 * s.bend * len * t;
        const m = Math.hypot(dx, dy);
        return m < 1e-9 ? [0, 1] : [-dy / m, dx / m];
    };
    // a rounded, not pointed, opening that still closes at the corners
    const gape = (t: number) => Math.max(0, s.open) * Math.pow(Math.max(0, 1 - t * t), 0.6);
    const rise = (t: number) => 0.35 * gape(t);
    const drop = (t: number) => 0.65 * gape(t);

    const pts: V2[] = [];
    // top edge, left to right
    for (let i = 0; i <= EDGE_STEPS; i++) {
        const t = -1 + (2 * i) / EDGE_STEPS;
        const [cx, cy] = centre(t);
        const [nx, ny] = normal(t);
        const d = half + rise(t);
        pts.push([cx + nx * d, cy + ny * d]);
    }
    // right cap: half circle from +n through the tangent to -n
    pushCap(pts, centre(1), normal(1), half, 1);
    // bottom edge, right to left
    for (let i = EDGE_STEPS; i >= 0; i--) {
        const t = -1 + (2 * i) / EDGE_STEPS;
        const [cx, cy] = centre(t);
        const [nx, ny] = normal(t);
        const d = half + drop(t);
        pts.push([cx - nx * d, cy - ny * d]);
    }
    pushCap(pts, centre(-1), normal(-1), half, -1);

    const a = (s.angle * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return pts.map(([lx, ly]) => {
        const u = lx * cos - ly * sin;
        const v = (lx * sin + ly * cos) * s.squash;
        return [u + s.x, v + s.y];
    });
}

function pushCap(pts: V2[], c: V2, n: V2, r: number, side: 1 | -1) {
    // tangent pointing out of this end of the stroke
    const tx = n[1] * side;
    const ty = -n[0] * side;
    for (let i = 1; i < CAP_STEPS; i++) {
        const a = (Math.PI * i) / CAP_STEPS;
        // start at +n on the right cap, -n on the left, sweeping outward
        const sx = side === 1 ? n[0] : -n[0];
        const sy = side === 1 ? n[1] : -n[1];
        pts.push([c[0] + (sx * Math.cos(a) + tx * Math.sin(a)) * r, c[1] + (sy * Math.cos(a) + ty * Math.sin(a)) * r]);
    }
}

export interface Basis {
    c: V3;
    e1: V3;
    e2: V3;
    roll: number;
}

export function faceBasis(o: Orientation): Basis {
    const y = (o.yaw * Math.PI) / 180;
    const p = (o.pitch * Math.PI) / 180;
    return {
        c: [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)],
        e1: [Math.cos(y), 0, -Math.sin(y)],
        e2: [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)],
        roll: (o.roll * Math.PI) / 180,
    };
}

/** Wrap a face-space point onto the sphere: returns screen x, y (y down) and depth z. */
export function wrap(b: Basis, u0: number, v0: number): V3 {
    const cr = Math.cos(b.roll);
    const sr = Math.sin(b.roll);
    const u = u0 * cr - v0 * sr;
    const v = u0 * sr + v0 * cr;
    const r = Math.hypot(u, v);
    const k = r < 1e-9 ? 1 : Math.sin(r) / r;
    const cosr = Math.cos(r);
    let x = b.c[0] * cosr + (u * b.e1[0] + v * b.e2[0]) * k;
    let y = b.c[1] * cosr + (u * b.e1[1] + v * b.e2[1]) * k;
    let z = b.c[2] * cosr + (u * b.e1[2] + v * b.e2[2]) * k;
    if (z < 0) {
        // behind the horizon: pin to the rim so the shape slides off the edge
        const m = Math.hypot(x, y) || 1;
        x /= m;
        y /= m;
        z = 0;
    }
    return [x, -y, z];
}

/** Expressions are authored small; this sets how much of the sphere the face covers. */
export const FACE_SCALE = 2.6;

export function strokePath(b: Basis, s: Stroke, radius: number, weight = 1): string {
    if (s.width <= 1e-4) return "";
    const pts = strokeOutline({ ...s, width: s.width * weight }).map(([u, v]) => wrap(b, u * FACE_SCALE, v * FACE_SCALE));
    return (
        pts.map(([x, y], i) => `${i ? "L" : "M"}${(x * radius).toFixed(2)} ${(y * radius).toFixed(2)}`).join("") + "Z"
    );
}

/** Point on the sphere under a screen point (sphere units, y down) → orientation that faces it. */
export function orientationToward(x: number, y: number, limit = 0.96): Pick<Orientation, "yaw" | "pitch"> {
    const m = Math.hypot(x, y);
    if (m > limit) {
        x = (x / m) * limit;
        y = (y / m) * limit;
    }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    return {
        yaw: (Math.atan2(x, z) * 180) / Math.PI,
        pitch: (Math.asin(-y) * 180) / Math.PI,
    };
}
