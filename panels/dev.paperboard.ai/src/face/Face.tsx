import { For, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { FaceController } from "./controller";
import { EXPRESSIONS } from "./expressions";
import { FEATURES, arrayToPose, faceBasis, poseToArray, strokePath, type Orientation } from "./geometry";
import styles from "./Face.module.css";

const R = 80;
const BLINK_MS = 170;
/** Below this size strokes thicken so the face still reads as an icon. */
const WEIGHT_SIZE = 96;
/** Below this size the view crops to the face itself instead of its whole sphere. */
const CROP_SIZE = 120;
const CROP_HALF = 58;

interface Spring {
    x: number[];
    v: number[];
}

const spring = (s: Spring, target: readonly number[], k: number, c: number, dt: number) => {
    for (let i = 0; i < target.length; i++) {
        const a = k * (target[i]! - s.x[i]!) - c * s.v[i]!;
        s.v[i]! += a * dt;
        s.x[i]! += s.v[i]! * dt;
    }
};

export function Face(props: {
    face: FaceController;
    size?: number;
    /** "face" zooms in on the features; "sphere" shows the whole hidden sphere. Small sizes default to "face". */
    frame?: "face" | "sphere";
    class?: string;
}) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const o0 = props.face.orientation();
    const p0 = poseToArray(EXPRESSIONS[props.face.expression()]);
    const orient: Spring = { x: [o0.yaw, o0.pitch, o0.roll], v: [0, 0, 0] };
    const pose: Spring = { x: [...p0], v: p0.map(() => 0) };

    // vertical hop: bounce() kicks its velocity and a spring brings it home
    const hop: Spring = { x: [0], v: [0] };
    const [frame, setFrame] = createSignal({ paths: FEATURES.map(() => ""), facing: 1, dx: 0, dy: 0, cx: 0, cy: 0 });

    let blinkAt = -Infinity;
    createEffect(on(props.face.blinkRequest, () => (blinkAt = performance.now()), { defer: true }));
    createEffect(on(props.face.bounceRequest, () => (hop.v[0] = reduced.matches ? 0 : 230), { defer: true }));

    // blink on its own every few seconds, like anything alive
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
        blinkTimer = setTimeout(
            () => {
                blinkAt = performance.now();
                scheduleBlink();
            },
            2200 + Math.random() * 3800,
        );
    };

    const size = () => props.size ?? 160;
    const cropped = () => (props.frame ? props.frame === "face" : size() < CROP_SIZE);
    // effective size of the face on screen, so cropping counts as zooming in
    const weight = () =>
        Math.max(1, Math.pow(WEIGHT_SIZE / (cropped() ? (size() * 100) / CROP_HALF : size()), 0.6));

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = now / 1000;
        const calm = reduced.matches;
        const shaking = props.face.shaking() && !calm;
        const talking = props.face.talking();

        const o = props.face.orientation();
        // pondering drifts between glances; direct looks snap with a little bounce
        if (props.face.pondering()) spring(orient, [o.yaw, o.pitch, o.roll], 22, 9, dt);
        else spring(orient, [o.yaw, o.pitch, o.roll], 90, 13, dt);
        spring(pose, poseToArray(EXPRESSIONS[props.face.expression()]), 260, 28, dt);
        spring(hop, [0], 160, 9, dt);

        const current: Orientation = {
            yaw: orient.x[0]! + (shaking ? 2.5 * Math.sin(t * 71) : 0),
            pitch: orient.x[1]! + (talking && !calm ? 1.4 * Math.sin(t * 6.5) : 0),
            roll: orient.x[2]! + (shaking ? 2 * Math.sin(t * 53 + 1) : 0),
        };
        const p = arrayToPose(pose.x);

        if (talking) {
            const chatter = Math.abs(Math.sin(t * 13.1) * Math.sin(t * 7.7 + 0.4));
            // the whole mouth opens and widens a touch, rather than a lump dropping out of it
            p.mouth.open += 0.02 + 0.05 * chatter;
            p.mouth.len *= 1 + 0.08 * chatter;
        }
        const since = now - blinkAt;
        if (since >= 0 && since < BLINK_MS) {
            const shut = 1 - 0.88 * Math.sin((Math.PI * since) / BLINK_MS);
            p.eyeL.squash *= shut;
            p.eyeR.squash *= shut;
        }

        const b = faceBasis(current);
        setFrame({
            paths: FEATURES.map((f) => strokePath(b, p[f], R, weight())),
            // fade the features as the face turns past the horizon
            facing: Math.min(1, Math.max(0, (b.c[2] + 0.15) / 0.3)),
            dx: shaking ? 2.2 * Math.sin(t * 83) : 0,
            dy: hop.x[0]! + (shaking ? 1.6 * Math.sin(t * 67 + 2) : 0),
            cx: b.c[0] * R,
            cy: -b.c[1] * R,
        });
        raf = requestAnimationFrame(tick);
    };

    onMount(() => {
        raf = requestAnimationFrame(tick);
        scheduleBlink();
    });
    onCleanup(() => {
        cancelAnimationFrame(raf);
        clearTimeout(blinkTimer);
    });

    // The face lives on an invisible sphere: only the features are drawn, but
    // they still wrap and foreshorten as it turns.
    return (
        <svg
            class={`${styles.face} ${props.class ?? ""}`}
            viewBox={
                cropped()
                    ? `${frame().cx - CROP_HALF} ${frame().cy - frame().dy - CROP_HALF} ${CROP_HALF * 2} ${CROP_HALF * 2}`
                    : "-100 -100 200 200"
            }
            width={size()}
            height={size()}
            role="img"
            aria-label={`AI, looking ${props.face.expression()}`}
        >
            <g class={styles.ink} opacity={frame().facing} transform={`translate(${frame().dx} ${-frame().dy})`}>
                <For each={FEATURES}>{(_, i) => <path d={frame().paths[i()]} />}</For>
            </g>
        </svg>
    );
}
