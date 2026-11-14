import styles from "./index.module.css";
import { onCleanup, Show, type JSX } from "solid-js";
import { Transition } from "solid-transition-group";

/** How an element arrives; it leaves the same way, in reverse. */
export type PaperMotion = "fade" | "pop" | "slide-up" | "slide-down" | "slide-start" | "slide-end";

export interface PaperPresenceProps {
    /** shown while truthy; stays mounted until its exit animation ends */
    when: unknown;
    /** a preset; ignored where enterClass/exitClass are given */
    motion?: PaperMotion;
    /** a component's own keyframes instead of a preset */
    enterClass?: string;
    exitClass?: string;
    /** animate on first mount too, not only when `when` changes */
    appear?: boolean;
    /** a single element */
    children: JSX.Element;
}

const PRESETS: Record<PaperMotion, string> = {
    fade: styles.fade,
    pop: styles.pop,
    "slide-up": styles.slideUp,
    "slide-down": styles.slideDown,
    "slide-start": styles.slideStart,
    "slide-end": styles.slideEnd,
};

export function prefersReducedMotion(el?: Element): boolean {
    if (el?.closest('[data-paperui-motion="reduced"]')) return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// longest animation on the element itself, in ms ("0.2s, 150ms" lists)
function longestAnimation(el: Element): number {
    const style = getComputedStyle(el);
    const ms = (list: string) => list.split(",").map((v) => (v.trim().endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000) || 0);
    const durations = ms(style.animationDuration ?? "");
    const delays = ms(style.animationDelay ?? "");
    return Math.max(0, ...durations.map((d, i) => d + (delays[i % delays.length] ?? 0)));
}

// the margin past the declared duration before we stop waiting for animationend
const END_GRACE_MS = 50;

/**
 * Mounts and unmounts one element with an enter and exit animation. The
 * element leaves the DOM only once its own animation has ended (or would
 * have: a timer backs up animationend), and at once under reduced motion.
 */
export function PaperPresence(props: PaperPresenceProps) {
    // at most one running animation per element, all cancelled on unmount
    const running = new Map<Element, { kind: "enter" | "exit"; finish: () => void; cancel: () => void }>();
    onCleanup(() => {
        for (const animation of running.values()) animation.cancel();
        running.clear();
    });

    // inserted, with the enter that animates it in still queued for the
    // microtask after insertion
    const arriving = new WeakSet<Element>();

    const play = (el: Element, kind: "enter" | "exit", classes: string, done: () => void) => {
        if (kind === "enter") arriving.delete(el);
        // An element hidden again in the update that showed it was never
        // painted: it leaves at once, with nothing to fade from.
        if (kind === "exit" && arriving.has(el)) {
            arriving.delete(el);
            done();
            return;
        }
        // An enter that reaches an element already leaving has nothing to
        // arrive for; the exit, which takes it out of the DOM, runs to its end.
        const current = running.get(el);
        if (kind === "enter" && current?.kind === "exit") {
            done();
            return;
        }
        // an enter that an exit interrupts is over: its done always runs
        current?.finish();
        // Resolve the previous classes' removal before reusing a preset's
        // animation-name. Without a rendering frame between enter and exit,
        // CSS otherwise reuses enter's timeline and can end exit immediately.
        void getComputedStyle(el).animationName;
        const tokens = classes.split(" ").filter(Boolean);
        el.classList.add(...tokens);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onEnd = (e: Event) => {
            if (e.target === el) finish();
        };
        const cancel = () => {
            clearTimeout(timer);
            el.removeEventListener("animationend", onEnd);
            el.classList.remove(...tokens);
            if (running.get(el) === animation) running.delete(el);
        };
        // done first: an exiting element must leave before its class does,
        // or it flashes back for a frame
        const finish = () => {
            if (running.get(el) !== animation) return;
            done();
            cancel();
        };
        const animation = { kind, finish, cancel };
        running.set(el, animation);
        const length = prefersReducedMotion(el) ? 0 : longestAnimation(el);
        if (length === 0) {
            queueMicrotask(finish);
            return;
        }
        el.addEventListener("animationend", onEnd);
        timer = setTimeout(finish, length + END_GRACE_MS);
    };

    const preset = () => PRESETS[props.motion ?? "fade"];

    return (
        <Transition
            appear={props.appear}
            onBeforeEnter={(el) => arriving.add(el)}
            onEnter={(el, done) => play(el, "enter", props.enterClass ?? `${styles.enter} ${preset()}`, done)}
            onExit={(el, done) => play(el, "exit", props.exitClass ?? `${styles.exit} ${preset()}`, done)}
        >
            <Show when={props.when}>{props.children}</Show>
        </Transition>
    );
}
