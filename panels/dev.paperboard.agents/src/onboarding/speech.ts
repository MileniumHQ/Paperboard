import { createSignal, onCleanup } from "solid-js";
import type { FaceController } from "../face/controller";
import { EXPRESSIONS, type Expression } from "../face/expressions";

// A line of speech is plain text with stage directions:
//   [happy]        change expression (after a short beat)
//   [bounce]       hop
//   [pause 600]    wait
//   **word**       bold
//   \n             line break inside the same bubble
// Each line swaps the bubble: the old one fades out before the new one types in.
// The last line stays up.

export type Beat =
    | { kind: "text"; text: string; bold: boolean }
    | { kind: "face"; expression: Expression }
    | { kind: "bounce" }
    | { kind: "pause"; ms: number }
    | { kind: "br" };

export interface Segment {
    text: string;
    bold: boolean;
    br?: boolean;
}

const TYPE_MS = 26;
const PUNCT_MS = 230;
const BEFORE_FACE_MS = 380;
/** Matches the bubble's exit transition (half of --paper-medium-transition). */
const SWAP_MS = 200;

export function parse(line: string): Beat[] {
    const beats: Beat[] = [];
    let bold = false;
    for (const part of line.split(/(\[[^\]]+\]|\*\*|\n)/)) {
        if (!part) continue;
        if (part === "**") bold = !bold;
        else if (part === "\n") beats.push({ kind: "br" });
        else if (part.startsWith("[") && part.endsWith("]")) {
            const [word, arg] = part.slice(1, -1).trim().split(/\s+/);
            if (word === "bounce") beats.push({ kind: "bounce" });
            else if (word === "pause") beats.push({ kind: "pause", ms: Number(arg) || 500 });
            else if (word && word in EXPRESSIONS) beats.push({ kind: "face", expression: word as Expression });
            else throw new Error(`unknown stage direction: ${part}`);
        } else beats.push({ kind: "text", text: part, bold });
    }
    return beats;
}

/** How long a finished line stays up before the next one replaces it. */
const holdFor = (line: string) => Math.min(2800, Math.max(1200, line.length * 30));

export function createSpeaker(face: FaceController) {
    const [segments, setSegments] = createSignal<Segment[]>([]);
    const [speaking, setSpeaking] = createSignal(false);
    // whether the bubble is up; text stays in place while it fades out
    const [shown, setShown] = createSignal(false);

    // every say() gets a generation; a newer one (or cleanup) cancels the old
    let generation = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const sleep = (ms: number, gen: number) =>
        new Promise<boolean>((resolve) => {
            const t = setTimeout(() => {
                timers.delete(t);
                resolve(gen === generation);
            }, ms);
            timers.add(t);
        });
    const stop = () => {
        generation++;
        timers.forEach(clearTimeout);
        timers.clear();
        face.talk(false);
        setSpeaking(false);
    };
    onCleanup(stop);

    const append = (text: string, bold: boolean) =>
        setSegments((s) => {
            const last = s[s.length - 1];
            if (last && !last.br && last.bold === bold) return [...s.slice(0, -1), { ...last, text: last.text + text }];
            return [...s, { text, bold }];
        });

    /** Speak the lines in order. Resolves true when finished, false if interrupted. */
    const say = async (lines: string[]): Promise<boolean> => {
        stop();
        const gen = generation;
        setSpeaking(true);
        for (let li = 0; li < lines.length; li++) {
            if (segments().length > 0) {
                setShown(false);
                if (!(await sleep(SWAP_MS, gen))) return false;
            }
            setSegments([]);
            setShown(true);
            for (const beat of parse(lines[li]!)) {
                if (beat.kind === "face") {
                    face.talk(false);
                    if (!(await sleep(BEFORE_FACE_MS, gen))) return false;
                    face.express(beat.expression);
                } else if (beat.kind === "bounce") face.bounce();
                else if (beat.kind === "pause") {
                    face.talk(false);
                    if (!(await sleep(beat.ms, gen))) return false;
                } else if (beat.kind === "br") setSegments((s) => [...s, { text: "", bold: false, br: true }]);
                else {
                    face.talk(true);
                    for (const ch of beat.text) {
                        append(ch, beat.bold);
                        if (!(await sleep(/[,.!?:]/.test(ch) ? PUNCT_MS : TYPE_MS, gen))) return false;
                    }
                }
            }
            face.talk(false);
            if (li < lines.length - 1 && !(await sleep(holdFor(lines[li]!), gen))) return false;
        }
        setSpeaking(false);
        return true;
    };

    /** Wait without speaking; false if interrupted. */
    const wait = (ms: number) => sleep(ms, generation);

    const clear = () => {
        setShown(false);
        setSegments([]);
    };

    return { segments, speaking, shown, say, wait, stop, clear };
}

export type Speaker = ReturnType<typeof createSpeaker>;
