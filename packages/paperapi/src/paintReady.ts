// A document load and an authenticated hydration are not a painted UI:
// fonts and images can still arrive a frame or two later, shifting the
// layout after a shell has already revealed the frame. Panels await this
// before answering the readiness challenge, and the library awaits it
// before telling Paperboard it is ready, so "ready" means the pixels are
// settled, not merely that the code ran.

export interface ContentPaintedOptions {
    /** Ultimate bound; a slow or broken asset must not hide the UI forever. */
    timeoutMs?: number;
    /** Subtree to inspect; defaults to the whole document. */
    root?: ParentNode;
}

const DEFAULT_CONTENT_PAINT_TIMEOUT_MS = 4_000;

// jsdom (and other non-rendering hosts) parse <img> but never load it and
// expose no decode(); waiting on them would hang forever instead of
// proving anything. Real browsers implement decode(), which is the signal
// that image loading can be observed here.
function canObserveImageDecode(): boolean {
    return (
        typeof HTMLImageElement !== "undefined" &&
        typeof HTMLImageElement.prototype.decode === "function"
    );
}

function waitForImage(img: HTMLImageElement): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            img.removeEventListener("load", finish);
            img.removeEventListener("error", finish);
            resolve();
        };
        // An offscreen lazy image is deliberately not loaded yet; waiting on
        // it would stall the first paint for as long as the caller's bound.
        if (img.loading === "lazy" && !img.complete) {
            finish();
            return;
        }
        // A broken image rejects decode(); try/catch keeps it from blocking
        // the reveal and the error path falls through to finish().
        try {
            void img.decode().then(finish, finish);
        } catch {
            finish();
        }
        img.addEventListener("load", finish);
        img.addEventListener("error", finish);
        if (img.complete) finish();
    });
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== "function") {
            resolve();
            return;
        }
        // Two frames: one to apply styles, one to paint the result.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * Resolves once fonts and images under `root` have settled and a paint has
 * been given a chance to happen. Never rejects; a broken or slow asset is
 * bounded by `timeoutMs`.
 */
export async function waitForContentPainted(
    options: ContentPaintedOptions = {},
): Promise<void> {
    if (typeof document === "undefined") return;
    const root = options.root ?? document;
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONTENT_PAINT_TIMEOUT_MS;

    const settle = async () => {
        const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
        if (fonts?.ready) {
            try {
                await fonts.ready;
            } catch {
                // Font loading is best effort; a missing font must not block.
            }
        }
        if (canObserveImageDecode()) {
            const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
            await Promise.all(images.map(waitForImage));
        }
        await nextFrame();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
    });
    try {
        await Promise.race([settle(), timeout]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
