// How much of the bottom of this document the phone's on-screen keyboard
// covers. A panel is an iframe in the shell, and the keyboard shrinks only
// the top-level page's visual viewport, so the answer is found by walking up
// the frames to it. Pure of the DOM's globals so the walk is testable.

export interface ViewportFrame {
    /** the visual viewport's bottom edge in this window's layout coordinates; null for a window without one */
    visualBottom: number | null;
    /** this window's height, in its own coordinates */
    height: number;
    /**
     * Where this window's top edge sits in its parent's coordinates, and the
     * parent. null at the top. A parent that isn't readable (another origin)
     * throws a SecurityError, and the walk stops there.
     */
    parent: () => { top: number; frame: ViewportFrame } | null;
}

/** the covered height at the bottom of a document: 0 when the keyboard is down */
export function keyboardInsetOf(frame: ViewportFrame): number {
    let bottom = frame.height;
    let at: ViewportFrame = frame;
    for (;;) {
        let up: ReturnType<ViewportFrame["parent"]>;
        try {
            up = at.parent();
        } catch (err) {
            // another origin: its keyboard can't be read from here, so this window's own viewport answers
            if (err instanceof DOMException && err.name === "SecurityError") break;
            throw err;
        }
        if (!up) break;
        bottom += up.top;
        at = up.frame;
    }
    if (at.visualBottom === null) return 0;
    return Math.max(0, Math.round(bottom - at.visualBottom));
}

function frameOf(win: Window): ViewportFrame {
    const viewport = win.visualViewport;
    return {
        visualBottom: viewport ? viewport.offsetTop + viewport.height : null,
        height: win.innerHeight,
        parent: () => {
            if (win.parent === win) return null;
            const element = win.frameElement;
            // a frame that is not an element of its parent (a sandbox without same-origin) can't be placed
            if (!element) throw new DOMException("the parent window can't be read", "SecurityError");
            return { top: element.getBoundingClientRect().top + element.clientTop, frame: frameOf(win.parent) };
        },
    };
}

/** the on-screen keyboard's height over this window, now */
export function keyboardInset(): number {
    return keyboardInsetOf(frameOf(window));
}

/**
 * Calls `onChange` with the keyboard's height whenever it changes, and once
 * now. Returns what stops it. A window whose top-level viewport can't be
 * read hears only its own.
 */
export function watchKeyboardInset(onChange: (inset: number) => void): () => void {
    let last = -1;
    const update = () => {
        const inset = keyboardInset();
        if (inset === last) return;
        last = inset;
        onChange(inset);
    };
    const viewports: VisualViewport[] = [];
    let win: Window = window;
    for (;;) {
        if (win.visualViewport) viewports.push(win.visualViewport);
        if (win.parent === win) break;
        try {
            // reading anything of another origin's window throws
            void win.parent.document;
        } catch (err) {
            if (err instanceof DOMException && err.name === "SecurityError") break;
            throw err;
        }
        win = win.parent;
    }
    for (const viewport of viewports) {
        viewport.addEventListener("resize", update);
        viewport.addEventListener("scroll", update);
    }
    update();
    return () => {
        for (const viewport of viewports) {
            viewport.removeEventListener("resize", update);
            viewport.removeEventListener("scroll", update);
        }
    };
}
