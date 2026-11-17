import { For, Show, createEffect, createSignal, createUniqueId, on, onCleanup, onMount } from "solid-js";
import type { FaceController } from "./controller";
import { EXPRESSIONS } from "./expressions";
import { FEATURES, arrayToPose, faceBasis, poseToArray, strokePath, type Orientation } from "./geometry";
import { BLINK_MS, blinkSince, frameSeconds } from "./blink";
import styles from "./Face.module.css";
import type { FaceSkin } from "./skins";

const R = 80;
/** the hologram's rim, in the sphere's own units */
const RIM = 3;
/** Below this size strokes thicken so the face still reads as an icon. */
const WEIGHT_SIZE = 96;
/** Below this size the view crops to the face itself instead of its whole sphere. */
const CROP_SIZE = 120;
const CROP_HALF = 58;

interface Spring {
    x: number[];
    v: number[];
}

/** a spring that has stopped: on its target, with no speed left */
const REST = 1e-3;
const atRest = (s: Spring, target: readonly number[]) => target.every((t, i) => Math.abs(t - s.x[i]!) < REST && Math.abs(s.v[i]!) < REST);

interface Frame {
    paths: string[];
    facing: number;
    dx: number;
    dy: number;
    cx: number;
    cy: number;
}
const sameFrame = (a: Frame, b: Frame) => a.facing === b.facing && a.dx === b.dx && a.dy === b.dy && a.cx === b.cx && a.cy === b.cy && a.paths.every((p, i) => p === b.paths[i]);

const spring = (s: Spring, target: readonly number[], k: number, c: number, dt: number) => {
    for (let i = 0; i < target.length; i++) {
        const a = k * (target[i]! - s.x[i]!) - c * s.v[i]!;
        s.v[i]! += a * dt;
        s.x[i]! += s.v[i]! * dt;
    }
};

/** the agent's face wherever it is the head of the page: the chat's top, the first meeting */
export const AGENT_FACE_PX = 56;

export function Face(props: {
    face: FaceController;
    size?: number;
    /** "face" zooms in on the features; "sphere" shows the whole hidden sphere. Small sizes default to "face". */
    frame?: "face" | "sphere";
    /** a painted sphere and features (see skins.ts); a painted face is always shown whole */
    skin?: FaceSkin | null;
    /** the sphere drawn as the Agent's hologram: a ball glowing in the panel's color, with a bright rim; a skin wins over it */
    hologram?: boolean;
    class?: string;
}) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const o0 = props.face.orientation();
    const p0 = poseToArray(EXPRESSIONS[props.face.expression()]);
    const orient: Spring = { x: [o0.yaw, o0.pitch, o0.roll], v: [0, 0, 0] };
    const pose: Spring = { x: [...p0], v: p0.map(() => 0) };

    // vertical hop: bounce() kicks its velocity and a spring brings it home
    const hop: Spring = { x: [0], v: [0] };
    const [frame, setFrame] = createSignal<Frame>({ paths: FEATURES.map(() => ""), facing: 1, dx: 0, dy: 0, cx: 0, cy: 0 });

    let blinkAt = -Infinity;
    createEffect(
        on(
            props.face.blinkRequest,
            () => {
                blinkAt = performance.now();
                wake();
            },
            { defer: true },
        ),
    );
    createEffect(
        on(
            props.face.bounceRequest,
            () => {
                hop.v[0] = reduced.matches ? 0 : 230;
                wake();
            },
            { defer: true },
        ),
    );

    // blink on its own every few seconds, like anything alive
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
        blinkTimer = setTimeout(
            () => {
                blinkAt = performance.now();
                wake();
                scheduleBlink();
            },
            2200 + Math.random() * 3800,
        );
    };

    const id = createUniqueId();
    const size = () => props.size ?? 160;
    // a painted sphere cropped to the features would be a yellow square: it's always shown whole
    const cropped = () => !props.skin && (props.frame ? props.frame === "face" : size() < CROP_SIZE);
    // effective size of the face on screen, so cropping counts as zooming in
    const weight = () =>
        Math.max(1, Math.pow(WEIGHT_SIZE / (cropped() ? (size() * 100) / CROP_HALF : size()), 0.6));

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
        const dt = frameSeconds(now, last);
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
        const since = blinkSince(now, blinkAt);
        if (since !== null) {
            const shut = 1 - 0.88 * Math.sin((Math.PI * since) / BLINK_MS);
            p.eyeL.squash *= shut;
            p.eyeR.squash *= shut;
        }

        const b = faceBasis(current);
        const next: Frame = {
            paths: FEATURES.map((f) => strokePath(b, p[f], R, weight())),
            // fade the features as the face turns past the horizon
            facing: Math.min(1, Math.max(0, (b.c[2] + 0.15) / 0.3)),
            dx: shaking ? 2.2 * Math.sin(t * 83) : 0,
            dy: hop.x[0]! + (shaking ? 1.6 * Math.sin(t * 67 + 2) : 0),
            cx: b.c[0] * R,
            cy: -b.c[1] * R,
        };
        // a face that isn't moving draws nothing
        if (!sameFrame(frame(), next)) setFrame(next);
        const blinking = since !== null;
        const resting = !talking && !shaking && !blinking && atRest(orient, [o.yaw, o.pitch, o.roll]) && atRest(pose, poseToArray(EXPRESSIONS[props.face.expression()])) && atRest(hop, [0]);
        // everything has stopped: the loop stops with it, and starts again when something asks the face to move
        raf = resting ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    };
    // what moves the face: where it looks, how it feels, whether it talks or shakes, how big it draws
    createEffect(on([props.face.orientation, props.face.expression, props.face.pondering, props.face.shaking, props.face.talking, weight], wake));

    onMount(() => {
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
            aria-label={`Agent, looking ${props.face.expression()}`}
            style={props.skin ? { "--face-ink": props.skin.ink } : undefined}
        >
            <Show when={props.skin}>
                {(skin) => <circle cx={frame().dx} cy={-frame().dy} r={R} fill={skin().sphere} />}
            </Show>
            <Show when={props.hologram && !props.skin}>
                {/* a dark core brightening to the rim, and the rim itself; it bobs with the face */}
                <defs>
                    <radialGradient id={`${id}-glow`}>
                        <stop offset="0.35" class={styles.core} />
                        <stop offset="1" class={styles.glow} />
                    </radialGradient>
                </defs>
                <g class={styles.hologram} transform={`translate(${frame().dx} ${-frame().dy})`}>
                    <circle r={R} fill={`url(#${id}-glow)`} />
                    <circle r={R - RIM / 2} class={styles.rim} stroke-width={RIM} />
                </g>
            </Show>
            <g class={styles.ink} opacity={frame().facing} transform={`translate(${frame().dx} ${-frame().dy})`}>
                <For each={FEATURES}>{(_, i) => <path d={frame().paths[i()]} />}</For>
            </g>
        </svg>
    );
}
