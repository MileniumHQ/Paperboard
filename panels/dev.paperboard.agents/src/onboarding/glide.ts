// The onboarding centers one column on the page, so whenever a step's
// content comes or goes the column re-centers and the speaker above it
// jumps. This draws the speaker where it was and eases it to where it now
// is (FLIP), so it glides instead.
//
// The spacer above the column changes height exactly when the column
// re-centers, and a ResizeObserver reports it after layout but before the
// frame is painted, so the jump is never drawn.

/** a PaperUI token as the element has it: one that isn't set means PaperUI's styles didn't load, which is an error, never a guess */
function token(style: CSSStyleDeclaration, name: string): string {
    const v = style.getPropertyValue(name).trim();
    if (!v) throw new Error(`The PaperUI token ${name} isn't set`);
    return v;
}

function durationMs(v: string): number {
    return v.endsWith("ms") ? parseFloat(v) || 0 : (parseFloat(v) || 0) * 1000;
}

// how far the element is drawn from its place right now, mid-glide
function drawnOffset(el: HTMLElement): number {
    const translate = getComputedStyle(el).translate;
    if (!translate || translate === "none") return 0;
    return parseFloat(translate.split(" ")[1] ?? "0") || 0;
}

/** Glides `target()` to its new place whenever `spacer` changes size. Returns the teardown. */
export function glideWhenRecentered(spacer: Element, target: () => HTMLElement | undefined): () => void {
    let last: HTMLElement | undefined;
    let lastTop = 0;
    let glide: Animation | undefined;
    const observer = new ResizeObserver(() => {
        const el = target();
        if (!el?.isConnected) {
            last = undefined;
            return;
        }
        // The bottom edge is followed: the face sits on it while the bubble
        // above grows and shrinks. offsetTop is the laid-out place,
        // untouched by the glide's own translate.
        const top = el.offsetTop + el.offsetHeight;
        if (el !== last) {
            last = el;
            lastTop = top;
            return;
        }
        const moved = lastTop - top;
        lastTop = top;
        if (Math.abs(moved) < 1) return;
        const style = getComputedStyle(el);
        // the token is 0s under reduced motion: then it simply moves
        const duration = durationMs(token(style, "--paper-medium-transition"));
        if (duration <= 0) return;
        const from = moved + (glide?.playState === "running" ? drawnOffset(el) : 0);
        glide?.cancel();
        glide = el.animate([{ translate: `0 ${from}px` }, { translate: "0 0" }], {
            duration,
            easing: token(style, "--paper-ease-emphasized"),
        });
    });
    observer.observe(spacer);
    return () => {
        observer.disconnect();
        glide?.cancel();
    };
}
