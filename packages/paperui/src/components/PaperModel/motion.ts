// The viewer's motion, from PaperUI's motion tokens: a model's entrance and
// a reset glide take --paper-long-transition and --paper-ease-emphasized, so
// they move like the rest of the interface, and stand still wherever the
// tokens are zeroed (prefers-reduced-motion, data-paperui-motion="reduced").

/** How long a motion takes and how it eases, read from the tokens on `element`. */
export interface Motion {
    /** milliseconds; 0 when motion is reduced */
    duration: number;
    /** progress 0..1 to eased progress 0..1 */
    ease: (t: number) => number;
}

/** The motion PaperUI's tokens give `element`, for a long transition with the emphasized curve. */
export function readMotion(element: Element): Motion {
    const style = getComputedStyle(element);
    return {
        duration: parseDuration(style.getPropertyValue("--paper-long-transition")),
        ease: parseCubicBezier(style.getPropertyValue("--paper-ease-emphasized")),
    };
}

// "0.6s" or "600ms"; a token that isn't there means no motion
function parseDuration(value: string): number {
    const match = /^\s*([\d.]+)(m?s)\s*$/.exec(value);
    if (!match) return 0;
    const n = Number(match[1]);
    return match[2] === "s" ? n * 1000 : n;
}

// "cubic-bezier(0.16, 1, 0.3, 1)"; anything else eases linearly
function parseCubicBezier(value: string): (t: number) => number {
    const match = /cubic-bezier\(([^)]+)\)/.exec(value);
    const points = match?.[1].split(",").map(Number);
    if (!points || points.length !== 4 || points.some((n) => !Number.isFinite(n))) return (t) => t;
    return cubicBezier(points[0], points[1], points[2], points[3]);
}

/** CSS's cubic-bezier(): x is time, y is progress; solved for x by Newton's method, then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
    const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
    const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

    const solve = (x: number) => {
        let s = x;
        for (let i = 0; i < 8; i++) {
            const error = sampleX(s) - x;
            if (Math.abs(error) < 1e-6) return s;
            const slope = slopeX(s);
            if (Math.abs(slope) < 1e-6) break;
            s -= error / slope;
        }
        let lo = 0;
        let hi = 1;
        s = x;
        while (hi - lo > 1e-6) {
            if (sampleX(s) < x) lo = s;
            else hi = s;
            s = (lo + hi) / 2;
        }
        return s;
    };

    return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}
