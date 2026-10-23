import { createSignal } from "solid-js";
import { EXPRESSIONS, type Expression } from "./expressions";
import type { Orientation } from "./geometry";

/** Where the face rests when nothing is asking it to look elsewhere. */
export const HOME: Orientation = { yaw: 24, pitch: 20, roll: -5 };

export const SPOTS = {
    home: HOME,
    center: { yaw: 0, pitch: 0, roll: 0 },
    up: { yaw: 0, pitch: 48, roll: 0 },
    down: { yaw: 0, pitch: -42, roll: 0 },
    left: { yaw: -52, pitch: 4, roll: 4 },
    right: { yaw: 52, pitch: 4, roll: -4 },
    away: { yaw: 150, pitch: 10, roll: 0 },
} satisfies Record<string, Orientation>;

export type Spot = keyof typeof SPOTS;

/**
 * The face's public API. Everything is a target; the renderer springs toward
 * it, so callers never animate anything themselves.
 */
export interface FaceController {
    /** turn the face to a named spot or an explicit orientation (degrees) */
    look(to: Spot | Partial<Orientation>): void;
    express(expression: Expression): void;
    /** mouth moves while true */
    talk(on: boolean): void;
    blink(): void;
    /** a quick hop, for delight */
    bounce(): void;
    /** trembles in place while true, for strain (">_<") */
    shake(on: boolean): void;
    /** look around and cycle thinking faces until turned off, then settle back */
    ponder(on: boolean): void;
    /** stop timers; call when the face's owner goes away */
    dispose(): void;

    readonly orientation: () => Orientation;
    readonly expression: () => Expression;
    readonly talking: () => boolean;
    readonly shaking: () => boolean;
    /** bumps on every bounce() call so the renderer can react */
    readonly bounceRequest: () => number;
    readonly pondering: () => boolean;
    /** bumps on every blink() call so the renderer can react */
    readonly blinkRequest: () => number;
}

// Where the eyes wander while pondering. Glances stay in the lower half and
// hold long enough to read; about half keep the current face so it isn't
// changing expression on every glance.
const GLANCES: Orientation[] = [
    { yaw: -20, pitch: -14, roll: 5 },
    { yaw: 28, pitch: -10, roll: -6 },
    { yaw: 4, pitch: -26, roll: 0 },
    { yaw: 36, pitch: -24, roll: -5 },
    { yaw: -30, pitch: -28, roll: 4 },
    { yaw: 16, pitch: -4, roll: -3 },
];
const PONDER_FACES: Expression[] = ["thinking", "musing", "hmm", "focused", "skeptical", "thinking", "musing"];
const PONDER_HOLD = [2200, 3600] as const;
const AHA_CHANCE = 0.08;

export function createFace(initial: { expression?: Expression; at?: Spot | Orientation } = {}): FaceController {
    const start = typeof initial.at === "string" ? SPOTS[initial.at] : (initial.at ?? HOME);
    const [orientation, setOrientation] = createSignal<Orientation>({ ...start });
    const [expression, setExpression] = createSignal<Expression>(initial.expression ?? "happy");
    const [talking, setTalking] = createSignal(false);
    const [shaking, setShaking] = createSignal(false);
    const [bounceRequest, setBounceRequest] = createSignal(0);
    const [blinkRequest, setBlinkRequest] = createSignal(0);
    const [pondering, setPondering] = createSignal(false);

    let ponderTimer: ReturnType<typeof setTimeout> | undefined;
    let before: { at: Orientation; expression: Expression } | undefined;
    const pick = <T,>(xs: readonly T[], not?: T) => {
        const pool = xs.filter((x) => x !== not);
        return pool[Math.floor(Math.random() * pool.length)]!;
    };
    let lastGlance: Orientation | undefined;
    const ponderStep = () => {
        lastGlance = pick(GLANCES, lastGlance);
        setOrientation({ ...lastGlance });
        if (Math.random() < AHA_CHANCE) setExpression("aha");
        else if (Math.random() < 0.5 || !PONDER_FACES.includes(expression())) {
            setExpression(pick(PONDER_FACES, expression()));
        }
        const [lo, hi] = PONDER_HOLD;
        ponderTimer = setTimeout(ponderStep, lo + Math.random() * (hi - lo));
    };
    const stopPondering = () => {
        clearTimeout(ponderTimer);
        ponderTimer = undefined;
    };

    return {
        look(to) {
            if (typeof to === "string") setOrientation({ ...SPOTS[to] });
            else setOrientation((o) => ({ ...o, ...to }));
        },
        express(e) {
            if (!(e in EXPRESSIONS)) throw new Error(`unknown expression: ${e}`);
            setExpression(e);
        },
        talk: (on) => setTalking(on),
        blink: () => setBlinkRequest((n) => n + 1),
        bounce: () => setBounceRequest((n) => n + 1),
        shake: (on) => setShaking(on),
        ponder(on) {
            if (on === pondering()) return;
            setPondering(on);
            if (on) {
                before = { at: orientation(), expression: expression() };
                lastGlance = undefined;
                ponderStep();
            } else {
                stopPondering();
                if (before) {
                    setOrientation(before.at);
                    setExpression(before.expression);
                }
                before = undefined;
            }
        },
        dispose: stopPondering,
        orientation,
        expression,
        talking,
        shaking,
        bounceRequest,
        pondering,
        blinkRequest,
    };
}
