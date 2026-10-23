import type { Pose, Stroke } from "./geometry";

const stroke = (s: Partial<Stroke> & Pick<Stroke, "x" | "y">): Stroke => ({
    len: 0,
    angle: 0,
    bend: 0,
    width: 0.06,
    open: 0,
    squash: 1,
    ...s,
});

// A tick eye: a short, slightly leaning stroke. The default look.
const tick = (x: number, y = 0.12, len = 0.042, angle = 97) => stroke({ x, y, len, angle, width: 0.062 });

// Unused features keep their shape but have no width, so tweening in or out
// grows them from nothing; the hand also rises from below the chin.
const NO_BROW = stroke({ x: 0.13, y: 0.2, len: 0.05, angle: -14, width: 0 });
const NO_HAND = stroke({ x: 0.1, y: -0.42, len: 0.05, angle: 35, bend: -0.9, width: 0 });

export const EXPRESSIONS = {
    happy: {
        eyeL: tick(-0.15),
        eyeR: tick(0.13),
        mouth: stroke({ x: -0.01, y: -0.1, len: 0.12, bend: 0.55, width: 0.058 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    neutral: {
        eyeL: stroke({ x: -0.15, y: 0.09, width: 0.095 }),
        eyeR: stroke({ x: 0.13, y: 0.09, width: 0.095 }),
        mouth: stroke({ x: 0, y: -0.11, len: 0.13, angle: 3, width: 0.052 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    wink: {
        eyeL: tick(-0.15),
        eyeR: stroke({ x: 0.13, y: 0.1, len: 0.055, bend: -0.75, width: 0.055 }),
        mouth: stroke({ x: 0.0, y: -0.1, len: 0.12, angle: -7, bend: 0.4, width: 0.056 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    // one brow up, mouth pushed aside, a hand on the chin
    thinking: {
        eyeL: tick(-0.15, 0.11, 0.045, 96),
        eyeR: tick(0.13, 0.09, 0.024, 96),
        mouth: stroke({ x: -0.02, y: -0.12, len: 0.12, angle: 12, width: 0.052 }),
        brow: stroke({ x: 0.14, y: 0.215, len: 0.055, angle: -14, bend: -0.25, width: 0.05 }),
        hand: stroke({ x: 0.11, y: -0.2, len: 0.05, angle: 35, bend: -0.9, width: 0.055 }),
    },
    // eyes go tall rather than round and staring; the mouth parts into a small "o"
    surprised: {
        eyeL: stroke({ x: -0.15, y: 0.125, len: 0.02, angle: 92, width: 0.064 }),
        eyeR: stroke({ x: 0.13, y: 0.125, len: 0.02, angle: 92, width: 0.064 }),
        mouth: stroke({ x: -0.01, y: -0.11, len: 0.01, angle: 90, width: 0.06 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    // a quieter think: squinting, mouth pursed off to one side
    hmm: {
        eyeL: stroke({ x: -0.15, y: 0.12, len: 0.04, angle: 4, bend: 0.2, width: 0.055 }),
        eyeR: stroke({ x: 0.13, y: 0.12, len: 0.04, angle: -4, bend: 0.2, width: 0.055 }),
        mouth: stroke({ x: 0.05, y: -0.11, len: 0.04, angle: 8, width: 0.052 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    // the thinking face without the hand: eyes squinted, hand on chin
    musing: {
        eyeL: stroke({ x: -0.15, y: 0.125, len: 0.038, angle: 4, bend: 0.2, width: 0.055 }),
        eyeR: stroke({ x: 0.13, y: 0.125, len: 0.038, angle: -4, bend: 0.2, width: 0.055 }),
        mouth: stroke({ x: 0.03, y: -0.11, len: 0.05, angle: 6, width: 0.052 }),
        brow: NO_BROW,
        hand: stroke({ x: 0.11, y: -0.2, len: 0.05, angle: 35, bend: -0.9, width: 0.055 }),
    },
    // one brow up, flat mouth: "are you sure about that?"
    skeptical: {
        eyeL: tick(-0.15, 0.115, 0.04, 96),
        eyeR: tick(0.13, 0.11, 0.03, 96),
        mouth: stroke({ x: -0.03, y: -0.115, len: 0.1, angle: -6, width: 0.052 }),
        brow: stroke({ x: 0.14, y: 0.225, len: 0.055, angle: -10, bend: -0.3, width: 0.05 }),
        hand: NO_HAND,
    },
    // narrowed eyes, a low brow and a tight mouth: working on it
    focused: {
        eyeL: tick(-0.15, 0.11, 0.024, 92),
        eyeR: tick(0.13, 0.11, 0.024, 92),
        mouth: stroke({ x: -0.01, y: -0.11, len: 0.045, width: 0.052 }),
        brow: stroke({ x: 0.12, y: 0.19, len: 0.05, angle: 12, width: 0.045 }),
        hand: NO_HAND,
    },
    // the moment it clicks: eyes up and open, brow lifted, a small smile
    aha: {
        eyeL: stroke({ x: -0.15, y: 0.135, len: 0.012, angle: 90, width: 0.068 }),
        eyeR: stroke({ x: 0.13, y: 0.135, len: 0.012, angle: 90, width: 0.068 }),
        mouth: stroke({ x: -0.01, y: -0.1, len: 0.075, bend: 0.5, width: 0.055, open: 0.014 }),
        brow: stroke({ x: 0.13, y: 0.25, len: 0.05, angle: -4, bend: -0.35, width: 0.045 }),
        hand: NO_HAND,
    },
    // not convinced either way
    unsure: {
        eyeL: tick(-0.15, 0.115, 0.038, 100),
        eyeR: tick(0.13, 0.115, 0.038, 100),
        mouth: stroke({ x: 0.02, y: -0.12, len: 0.08, angle: -10, bend: -0.25, width: 0.052 }),
        brow: stroke({ x: 0.13, y: 0.215, len: 0.045, angle: -18, bend: -0.2, width: 0.045 }),
        hand: NO_HAND,
    },
    // eyes closed into happy arcs: pleased with how something went
    satisfied: {
        eyeL: stroke({ x: -0.15, y: 0.11, len: 0.045, bend: -0.8, width: 0.055 }),
        eyeR: stroke({ x: 0.13, y: 0.11, len: 0.045, bend: -0.8, width: 0.055 }),
        mouth: stroke({ x: -0.01, y: -0.1, len: 0.11, bend: 0.55, width: 0.058 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    // >_< straining at something hard
    strain: {
        eyeL: stroke({ x: -0.15, y: 0.11, len: 0.04, angle: 90, bend: 0.9, width: 0.052 }),
        eyeR: stroke({ x: 0.13, y: 0.11, len: 0.04, angle: 90, bend: -0.9, width: 0.052 }),
        mouth: stroke({ x: -0.01, y: -0.1, len: 0.07, width: 0.05 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    // hopeful: eyes lifted and bright, brow up, a small eager smile
    wish: {
        eyeL: stroke({ x: -0.15, y: 0.14, len: 0.016, angle: 90, width: 0.074 }),
        eyeR: stroke({ x: 0.13, y: 0.14, len: 0.016, angle: 90, width: 0.074 }),
        mouth: stroke({ x: -0.01, y: -0.095, len: 0.06, bend: 0.6, width: 0.055 }),
        brow: stroke({ x: 0.13, y: 0.25, len: 0.05, angle: -6, bend: -0.35, width: 0.045 }),
        hand: NO_HAND,
    },
    sad: {
        eyeL: tick(-0.15, 0.11, 0.04, 72),
        eyeR: tick(0.13, 0.11, 0.04, 108),
        mouth: stroke({ x: -0.01, y: -0.13, len: 0.1, bend: -0.45, width: 0.055 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
    sleepy: {
        eyeL: stroke({ x: -0.15, y: 0.09, len: 0.055, bend: 0.55, width: 0.05 }),
        eyeR: stroke({ x: 0.13, y: 0.09, len: 0.055, bend: 0.55, width: 0.05 }),
        mouth: stroke({ x: -0.01, y: -0.11, len: 0.035, width: 0.05 }),
        brow: NO_BROW,
        hand: NO_HAND,
    },
} satisfies Record<string, Pose>;

export type Expression = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as Expression[];
