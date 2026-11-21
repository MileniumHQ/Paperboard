import { Index, createEffect, createMemo, createSignal, on, onCleanup, onMount, splitProps, untrack, type JSX } from "solid-js";
import { cx } from "../../utils/cx";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export interface MarketingIcon {
    src: string;
    /** Where the icon comes to rest, as a fraction of the field's width (0 is the left edge). */
    x: number;
    /** Where the icon comes to rest, as a fraction of the field's height (0 is the top). */
    y: number;
}

export interface MarketingIconFieldProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> {
    /** The first icon floats in alone; the rest follow. */
    icons: readonly MarketingIcon[];
    /** Icon size in pixels. */
    size?: number;
    /** Seconds after the first icon before the rest are thrown in. */
    followAfter?: number;
    /** Set to send every icon flying up off the field, nearest the bottom centre first. */
    leaving?: boolean;
    /** Called once every icon has left. */
    onLeft?: () => void;
}

interface Body {
    x: number;
    y: number;
    vx: number;
    vy: number;
    a: number;
    av: number;
    lean: number;
    launch: number;
    homeFrom: number;
    homeFor: number;
    stiffness: number;
    damping: number;
    inside: boolean;
    exitAt: number;
    lift: number;
    exiting: boolean;
}

const SUBSTEPS = 8;
// How hard each kind of contact turns an icon; kept low so icons tumble a
// little and never spin.
const WALL_SPIN = 0.0012;
const BUMP_SPIN = 0.0015;
const RESTITUTION = 0.82;
const MAX_LEAN = 0.38;

/**
 * Icons thrown onto a marketing surface: the first floats in, the rest are
 * tossed after it, bounce off the edges and each other, and glide into
 * their resting places, leaning the way the site's icons do. Set `leaving`
 * and they lift off the top. With reduced motion they simply appear and
 * fade.
 */
export function MarketingIconField(props: MarketingIconFieldProps) {
    const [local, rest] = splitProps(props, ["icons", "size", "followAfter", "leaving", "onLeft", "class"]);
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = () => local.size ?? 120;
    const [gone, setGone] = createSignal(false);
    const elements: HTMLImageElement[] = [];
    let field: HTMLDivElement | undefined;
    let bodies: Body[] = [];
    let width = 0;
    let height = 0;
    let clock = 0;
    let frame = 0;
    let last = 0;
    let leftCalled = false;

    const smooth = (from: number, span: number, t: number) => {
        const k = Math.min(1, Math.max(0, (t - from) / span));
        return k * k * (3 - 2 * k);
    };
    const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
    // Resting lean follows the site's toy: right of centre leans right, and
    // the rule flips on the bottom half, so the set reads as a gentle swirl.
    const leanFor = (icon: MarketingIcon) => (icon.x * 2 - 1) * (icon.y > 0.5 ? -1 : 1) * MAX_LEAN;
    const target = (i: number) => {
        const icon = untrack(() => local.icons[i]);
        return { x: icon.x * width, y: icon.y * height };
    };

    function throwIn() {
        const icons = untrack(() => local.icons);
        const follow = untrack(() => local.followAfter) ?? 2.1;
        const scale = Math.max(0.5, width / 1920);
        clock = 0;
        leftCalled = false;
        bodies = icons.map((icon, i) => {
            const lean = leanFor(icon);
            if (i === 0) {
                return {
                    x: -size() * 0.75, y: height * 0.45, vx: 560 * scale, vy: -95 * scale,
                    a: lean - 0.35, av: 0.25, lean, launch: 0, homeFrom: 0.5, homeFor: 3.2,
                    stiffness: 5, damping: 4.2, inside: false, exitAt: Infinity, lift: 0, exiting: false,
                };
            }
            const launch = follow + (i - 1) * 0.16;
            return {
                x: -size() * 0.75 - Math.random() * 40, y: height * (0.25 + Math.random() * 0.5),
                vx: (1050 + Math.random() * 450) * scale, vy: (Math.random() - 0.5) * 900 * scale,
                a: lean + (Math.random() - 0.5) * 0.8, av: (Math.random() - 0.5) * 2.4, lean,
                launch, homeFrom: launch + 2, homeFor: 1.9,
                stiffness: 12, damping: 6.2, inside: false, exitAt: Infinity, lift: 0, exiting: false,
            };
        });
        if (reduced) {
            bodies.forEach((body, i) => Object.assign(body, target(i), { a: body.lean }));
            draw();
            return;
        }
        run();
    }

    function sendOff() {
        if (reduced) {
            setGone(true);
            // the fade is the whole exit; report once it has played
            window.setTimeout(finishLeaving, 400);
            return;
        }
        bodies.forEach((body) => {
            // a send-off already under way keeps its timing
            if (body.exitAt !== Infinity) return;
            const d = Math.hypot(body.x - width / 2, body.y - height * 0.67);
            body.exitAt = Math.max(clock, body.launch) + d / 2800 + Math.random() * 0.1;
            body.lift = 3400 + Math.random() * 1000;
        });
        run();
    }

    function finishLeaving() {
        if (leftCalled) return;
        leftCalled = true;
        untrack(() => local.onLeft)?.();
    }

    function step(t: number, dt: number) {
        bodies.forEach((body, i) => {
            if (t < body.launch) return;
            if (t >= body.exitAt) {
                // a small dip, then up with real inertia
                if (!body.exiting) {
                    body.exiting = true;
                    body.vx = (body.x - width / 2) * 0.18 + (Math.random() - 0.5) * 120;
                    body.vy = 140;
                    body.av = (Math.random() - 0.5) * 1.6;
                }
                body.vy -= body.lift * dt;
                body.x += body.vx * dt;
                body.y += body.vy * dt;
                body.a += body.av * dt;
                return;
            }
            const home = target(i);
            const k = smooth(body.homeFrom, body.homeFor, t);
            body.vx += (body.stiffness * k * (home.x - body.x) - body.damping * k * body.vx) * dt;
            body.vy += (body.stiffness * k * (home.y - body.y) - body.damping * k * body.vy) * dt;
            const drag = Math.pow(0.75, dt);
            body.vx *= drag;
            body.vy *= drag;
            // spin dies away on its own; homing eases the angle the short way to its lean
            body.av *= Math.pow(0.35, dt) * (1 - k * 6 * dt);
            body.a += body.av * dt + wrap(body.lean - body.a) * k * 3.2 * dt;
            body.x += body.vx * dt;
            body.y += body.vy * dt;
            const r = size() * 0.46;
            if (!body.inside && body.x - r > 8) body.inside = true;
            if (body.inside && body.x - r < 0) { body.x = r; body.vx = Math.abs(body.vx) * RESTITUTION; body.av += body.vy * WALL_SPIN; }
            if (body.x + r > width) { body.x = width - r; body.vx = -Math.abs(body.vx) * RESTITUTION; body.av -= body.vy * WALL_SPIN; }
            if (body.y - r < 0) { body.y = r; body.vy = Math.abs(body.vy) * RESTITUTION; body.av -= body.vx * WALL_SPIN; }
            if (body.y + r > height) { body.y = height - r; body.vy = -Math.abs(body.vy) * RESTITUTION; body.av += body.vx * WALL_SPIN; }
        });
        const min = size() * 0.92;
        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const a = bodies[i], b = bodies[j];
                if (t < a.launch || t < b.launch || a.exiting || b.exiting) continue;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
                if (d >= min || d < 0.001) continue;
                const nx = dx / d, ny = dy / d, push = (min - d) / 2;
                a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
                const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (closing > 0) continue;
                const impulse = (-(1 + 0.8) * closing) / 2;
                a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
                const slide = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
                a.av += slide * BUMP_SPIN;
                b.av -= slide * BUMP_SPIN;
            }
        }
    }

    function draw() {
        const half = size() / 2;
        bodies.forEach((body, i) => {
            const el = elements[i];
            if (!el) return;
            el.style.visibility = clock >= body.launch || reduced ? "visible" : "hidden";
            el.style.transform = `translate3d(${(body.x - half).toFixed(1)}px, ${(body.y - half).toFixed(1)}px, 0) rotate(${body.a.toFixed(4)}rad)`;
        });
    }

    // Settled: every icon home, still and leaning; nothing left to animate.
    const settled = () =>
        bodies.every((body, i) => {
            const home = target(i);
            return clock > body.homeFrom + body.homeFor && Math.hypot(body.vx, body.vy) < 2 &&
                Math.hypot(home.x - body.x, home.y - body.y) < 0.5 && Math.abs(wrap(body.lean - body.a)) < 0.002;
        });

    function tick(now: number) {
        const dt = Math.min(1 / 30, (now - last) / 1000);
        last = now;
        for (let s = 0; s < SUBSTEPS; s++) {
            step(clock, dt / SUBSTEPS);
            clock += dt / SUBSTEPS;
        }
        draw();
        const leaving = bodies.some((body) => body.exitAt !== Infinity);
        if (leaving && bodies.every((body) => body.y < -size())) {
            frame = 0;
            finishLeaving();
            return;
        }
        if (!leaving && settled()) {
            frame = 0;
            return;
        }
        frame = requestAnimationFrame(tick);
    }

    function run() {
        if (frame) return;
        last = performance.now();
        frame = requestAnimationFrame(tick);
    }

    onMount(() => {
        if (!field) throw new Error("MarketingIconField: the field did not render");
        const observer = new ResizeObserver(([entry]) => {
            const first = !width;
            width = entry.contentRect.width;
            height = entry.contentRect.height;
            // the first measure starts the show; later ones only move the
            // resting places, which the springs follow
            if (first) throwIn();
            else if (reduced) throwIn();
            else run();
        });
        observer.observe(field);
        onCleanup(() => observer.disconnect());
    });
    createEffect(on(() => local.icons, () => width && throwIn(), { defer: true }));
    const leaving = createMemo(() => Boolean(local.leaving));
    createEffect(on(leaving, (now) => now && width && sendOff(), { defer: true }));
    // frame is only ever set in a browser; a server render has nothing to cancel
    onCleanup(() => frame && cancelAnimationFrame(frame));

    return (
        <div
            {...rest}
            ref={field}
            class={cx(styles.field, reduced && styles.still, gone() && styles.gone, local.class)}
            aria-hidden="true"
        >
            <Index each={local.icons}>
                {(icon, i) => (
                    <img
                        ref={(el) => (elements[i] = el)}
                        class={styles.icon}
                        src={icon().src}
                        alt=""
                        width={size()}
                        height={size()}
                        draggable={false}
                    />
                )}
            </Index>
        </div>
    );
}
