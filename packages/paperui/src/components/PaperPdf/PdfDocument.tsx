// The PDF viewer itself, loaded on demand by PaperPdf (index.tsx) so pdf.js
// stays out of the main bundle. PaperPdf shows the loader and failures; this
// shows the pages and the controls over them.
import styles from "./index.module.css";
import { batch, createEffect, createSignal, Index, on, onCleanup, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { normalizeUnicode, TextLayer, type PDFDocumentProxy, type PDFDocumentLoadingTask, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import { PaperButton } from "../PaperButton";
import { PaperEmptyState } from "../PaperEmptyState";
import { PaperIcon } from "../PaperIcon";
import { PaperPreviewControls, PaperPreviewReadout } from "../../templates/PaperPreview/controls";
import { describePdfError, isCancellation, openPdf, pdfWorker, type PdfFailure } from "./pdfjs";

/** CSS pixels per PDF point: a zoom of 1 shows a page at its printed size. */
const CSS_UNITS = 96 / 72;
export const PDF_MIN_ZOOM = 0.25;
export const PDF_MAX_ZOOM = 5;
// what the zoom buttons step through
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
// a zoom that has rested this long is drawn sharp again
const SETTLE_MS = 160;
// one page's canvas never holds more pixels than this (32 MB); past it, a
// deep zoom draws a little soft rather than running out of memory
const MAX_CANVAS_PIXELS = 2 ** 23;
// pages drawn at once: one draws while pdf.js prepares the next
const MAX_RENDERS = 2;
// pages measured before a document shows; the rest are measured after, in
// batches of SIZE_BATCH
const PRESIZED = 50;
const SIZE_BATCH = 32;

export interface PdfViewerFailure {
    message: string;
    /** opens the document again, for failures where that could help */
    retry?: () => void;
}

export interface PdfDocumentProps {
    src: string;
    controls: boolean;
    onLoading: () => void;
    onReady: () => void;
    onFail: (failure: PdfViewerFailure) => void;
    /** a single page failed to draw; the rest of the document still shows */
    onPageError: (message: string) => void;
}

/** A page's size at zoom 1, in its own units, turned the way it shows. */
interface PageSize {
    width: number;
    height: number;
    /** the page's UserUnit: how many points one of its units is */
    unit: number;
    failed: boolean;
}

interface Job {
    cancelled: boolean;
    task?: RenderTask;
}

/** One page's drawing: what is on screen and what is being drawn. */
interface Slot {
    index: number;
    el?: HTMLDivElement;
    near: boolean;
    visible: boolean;
    canvas?: HTMLCanvasElement;
    /** the zoom `canvas` was drawn at; 0 when there is none */
    drawnZoom: number;
    job?: Job;
    text?: { layer: TextLayer; div: HTMLDivElement };
}

function sizeOf(page: PDFPageProxy): Omit<PageSize, "failed"> {
    const viewport = page.getViewport({ scale: 1 });
    const { pageWidth, pageHeight } = viewport.rawDims as { pageWidth: number; pageHeight: number };
    const turned = viewport.rotation % 180 !== 0;
    return { width: turned ? pageHeight : pageWidth, height: turned ? pageWidth : pageHeight, unit: page.userUnit };
}

const clampZoom = (zoom: number) => Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, zoom));

/** Frees a canvas's pixels now rather than whenever it is collected. */
function release(canvas: HTMLCanvasElement) {
    canvas.remove();
    canvas.width = 0;
    canvas.height = 0;
}

export function PdfDocument(props: PdfDocumentProps) {
    let scroller!: HTMLDivElement;
    let stage!: HTMLDivElement;
    let column!: HTMLDivElement;

    // the document on screen, and a number that changes with every new one:
    // late answers from an older load or render compare it and drop out
    let doc: PDFDocumentProxy | null = null;
    let loading: PDFDocumentLoadingTask | null = null;
    let generation = 0;
    const [docKey, setDocKey] = createSignal(0);
    const [pages, setPages] = createStore<PageSize[]>([]);
    let slots: Slot[] = [];

    // the zoom on screen; canvases are drawn at `drawZoom`, which follows it
    // once a pinch or a run of wheel steps has rested
    const [zoom, setZoom] = createSignal(1);
    const [fitting, setFitting] = createSignal(true);
    let drawZoom = 1;
    const [current, setCurrent] = createSignal(1);
    // the zoom as it looks, a running gesture's scale included
    const shownZoom = () => zoom() * gestureScale();

    // ---------- loading ----------

    const teardown = () => {
        for (const slot of slots) stopJob(slot);
        slots = [];
        near.clear();
        const task = loading;
        loading = null;
        doc = null;
        // quiet: destroying a document can reject when it never finished opening; that failure was already shown
        task?.destroy().catch(() => {});
    };

    const fail = (gen: number, src: string, failure: PdfFailure) => {
        if (gen !== generation) return;
        teardown();
        props.onFail({ message: failure.message, retry: failure.retryable ? () => open(src) : undefined });
    };

    const open = async (src: string) => {
        const gen = ++generation;
        teardown();
        clearTimeout(settleTimer);
        gesture = null;
        column.style.transform = "";
        column.classList.remove(styles.gesturing);
        batch(() => {
            setGestureScale(1);
            setDocKey(0);
            setPages([]);
            setCurrent(1);
        });
        props.onLoading();
        try {
            const thread = await pdfWorker();
            if (gen !== generation) return;
            const task = openPdf(src, thread);
            loading = task;
            const pdf = await task.promise;
            if (gen !== generation) return;
            // the first pages are measured before any shows, so the width
            // they're fitted to doesn't change under the reader; later pages
            // start the size of the first, which keeps the scrollbar right
            // for the usual document of one page size, and are measured
            // once the first pages are drawn
            const first = await pdf.getPage(1);
            const head = await Promise.allSettled(
                Array.from({ length: Math.min(PRESIZED, pdf.numPages) - 1 }, (_, i) => pdf.getPage(i + 2)),
            );
            if (gen !== generation) return;
            doc = pdf;
            const firstSize = { ...sizeOf(first), failed: false };
            const sizes = Array.from({ length: pdf.numPages }, (_, i) => {
                const result = i === 0 ? null : head[i - 1];
                return result?.status === "fulfilled" ? { ...sizeOf(result.value), failed: false } : { ...firstSize };
            });
            slots = Array.from({ length: pdf.numPages }, (_, index) => ({ index, near: false, visible: false, drawnZoom: 0 }));
            const fit = fitZoom(sizes);
            drawZoom = fit;
            batch(() => {
                setPages(sizes);
                setZoom(fit);
                setFitting(true);
                setDocKey(gen);
            });
            props.onReady();
        } catch (err) {
            fail(gen, src, describePdfError(err));
        }
    };

    createEffect(on(() => props.src, (src) => void open(src)));

    onCleanup(() => {
        generation++;
        teardown();
    });

    /**
     * Measures the pages after the first PRESIZED, keeping the reading
     * position. The zoom stays: a wider page found later scrolls sideways
     * until the reader fits the width again.
     */
    let sizing = 0;
    const sizeAll = async () => {
        const gen = generation;
        const pdf = doc;
        if (!pdf || sizing === gen) return;
        sizing = gen;
        for (let start = PRESIZED + 1; start <= pdf.numPages; start += SIZE_BATCH) {
            const numbers = Array.from({ length: Math.min(SIZE_BATCH, pdf.numPages - start + 1) }, (_, i) => start + i);
            // a page that can't be read keeps the first page's size; its own
            // render then shows the failure
            const results = await Promise.allSettled(numbers.map((n) => pdf.getPage(n)));
            if (gen !== generation) return;
            const changed: [number, Omit<PageSize, "failed">][] = [];
            results.forEach((result, i) => {
                if (result.status !== "fulfilled") return;
                const index = numbers[i] - 1;
                const size = sizeOf(result.value);
                const was = pages[index];
                if (size.width !== was.width || size.height !== was.height || size.unit !== was.unit) changed.push([index, size]);
            });
            if (changed.length === 0) continue;
            const top = viewPoint(true);
            const anchor = anchorAt(top.x, top.y);
            batch(() => {
                for (const [index, size] of changed) setPages(index, size);
            });
            restore(anchor);
        }
    };

    // ---------- geometry ----------

    const padding = () => {
        const style = getComputedStyle(column);
        return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    };

    /**
     * The zoom that makes the widest of the first PRESIZED pages fill the
     * width: the pages known when the document opens, so fitting again gives
     * the same zoom however far the reader has scrolled.
     */
    const fitZoom = (sizes: readonly PageSize[]) => {
        const widest = sizes.slice(0, PRESIZED).reduce((max, size) => Math.max(max, size.width * size.unit), 0);
        const room = scroller.clientWidth - padding();
        if (widest <= 0 || room <= 0) return 1;
        return clampZoom(room / (widest * CSS_UNITS));
    };

    /** The page whose top is at or above `y` in the column (binary search; pages run top to bottom). */
    const pageAtY = (y: number) => {
        let low = 0;
        let high = slots.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            const el = slots[mid].el;
            if (el && el.offsetTop <= y) low = mid;
            else high = mid - 1;
        }
        return low;
    };

    /** A point on a page, as fractions of the page, held under a point on screen. */
    interface Anchor {
        index: number;
        fx: number;
        fy: number;
        clientX: number;
        clientY: number;
    }

    /** Which page point is under (clientX, clientY), through a running gesture's transform. */
    const anchorAt = (clientX: number, clientY: number): Anchor | null => {
        if (slots.length === 0) return null;
        const box = stage.getBoundingClientRect();
        const g = gesture ?? RESTING;
        const x = (clientX - box.left - g.x) / g.scale;
        const y = (clientY - box.top - g.y) / g.scale;
        const index = pageAtY(y);
        const el = slots[index].el;
        if (!el) return null;
        return { index, fx: (x - el.offsetLeft) / el.offsetWidth, fy: (y - el.offsetTop) / el.offsetHeight, clientX, clientY };
    };

    /** Scrolls the anchored page point back under its screen point, once the pages have changed size. */
    const restore = (anchor: Anchor | null) => {
        const el = anchor && slots[anchor.index]?.el;
        if (!anchor || !el) return;
        const box = stage.getBoundingClientRect();
        scroller.scrollLeft += box.left + el.offsetLeft + anchor.fx * el.offsetWidth - anchor.clientX;
        scroller.scrollTop += box.top + el.offsetTop + anchor.fy * el.offsetHeight - anchor.clientY;
    };

    /** The middle of the viewer, or a point across its top, on screen. */
    const viewPoint = (top = false) => {
        const box = scroller.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: top ? box.top : box.top + box.height / 2 };
    };

    // ---------- zoom ----------

    // A pinch, or a run of ⌘/Ctrl-wheel steps, scales the column with a
    // transform: the compositor alone moves it, every frame, with no layout.
    // Once it rests the pages are laid out at the new zoom and drawn sharp.
    // On screen, a column point c sits at scale × c + (x, y) in the stage.
    interface Gesture {
        scale: number;
        x: number;
        y: number;
        clientX: number;
        clientY: number;
    }
    const RESTING: Gesture = { scale: 1, x: 0, y: 0, clientX: 0, clientY: 0 };
    let gesture: Gesture | null = null;
    const [gestureScale, setGestureScale] = createSignal(1);

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(settleTimer));
    /** Draws the pages at the zoom on screen once it has rested. */
    const settle = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            if (drawZoom === zoom()) return;
            drawZoom = zoom();
            schedule();
        }, SETTLE_MS);
    };

    /** Lays out the pages at the zoom a gesture reached, keeping the point under the fingers still. */
    const endGesture = () => {
        const g = gesture;
        if (!g) return;
        clearTimeout(settleTimer);
        const anchor = anchorAt(g.clientX, g.clientY);
        gesture = null;
        column.style.transform = "";
        column.classList.remove(styles.gesturing);
        batch(() => {
            setGestureScale(1);
            setZoom(clampZoom(zoom() * g.scale));
        });
        restore(anchor);
        drawZoom = zoom();
        schedule();
    };

    /** Zooms by `factor` around a point on screen, during a gesture. */
    const zoomBy = (factor: number, clientX: number, clientY: number) => {
        if (slots.length === 0) return;
        setFitting(false);
        const g = gesture ?? { ...RESTING };
        const step = clampZoom(zoom() * g.scale * factor) / (zoom() * g.scale);
        const box = stage.getBoundingClientRect();
        const px = clientX - box.left;
        const py = clientY - box.top;
        const scale = g.scale * step;
        // the column may only go where the laid-out pages could be scrolled
        // to, so nothing jumps when the gesture rests: narrower than the
        // view it is centered (and at the top when shorter); wider, its
        // edges never come inside the view
        const fit = (offset: number, size: number, scroll: number, view: number, center: boolean) =>
            size <= view ? scroll + (center ? (view - size) / 2 : 0) : Math.min(scroll, Math.max(scroll + view - size, offset));
        gesture = {
            scale,
            x: fit(px + step * (g.x - px), scale * column.offsetWidth, scroller.scrollLeft, scroller.clientWidth, true),
            y: fit(py + step * (g.y - py), scale * column.offsetHeight, scroller.scrollTop, scroller.clientHeight, false),
            clientX,
            clientY,
        };
        column.classList.add(styles.gesturing);
        column.style.transform = `translate(${gesture.x}px, ${gesture.y}px) scale(${gesture.scale})`;
        setGestureScale(gesture.scale);
        clearTimeout(settleTimer);
        settleTimer = setTimeout(endGesture, SETTLE_MS);
    };

    /** Zooms to `next` at once, keeping a point on screen still (the viewer's middle by default). */
    const zoomTo = (next: number, at = viewPoint()) => {
        endGesture();
        const target = clampZoom(next);
        if (target === zoom() || slots.length === 0) return;
        const anchor = anchorAt(at.x, at.y);
        setZoom(target);
        restore(anchor);
        settle();
    };

    const zoomIn = () => {
        setFitting(false);
        zoomTo(ZOOM_STEPS.find((step) => step > shownZoom() * 1.001) ?? PDF_MAX_ZOOM);
    };
    const zoomOut = () => {
        setFitting(false);
        zoomTo(ZOOM_STEPS.findLast((step) => step < shownZoom() / 1.001) ?? PDF_MIN_ZOOM);
    };
    const fitWidth = () => {
        setFitting(true);
        zoomTo(fitZoom(pages), viewPoint(true));
    };

    const onWheel = (e: WheelEvent) => {
        // a trackpad pinch arrives as a wheel with ctrlKey; ⌘ or Ctrl with a wheel zooms too
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1;
        // a pinch moves a few pixels per event and zooms exactly with it; a
        // mouse notch (100) is held to about a 1.3× step
        const delta = Math.max(-25, Math.min(25, e.deltaY * lines));
        zoomBy(Math.exp(-delta * 0.01), e.clientX, e.clientY);
    };

    // two fingers pinch, and pan as they move; one scrolls natively
    // (touch-action: pan-x pan-y)
    let pinch: { distance: number; x: number; y: number } | null = null;
    const touchPair = (e: TouchEvent) => {
        const [a, b] = [e.touches[0], e.touches[1]];
        return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    const onTouchStart = (e: TouchEvent) => {
        pinch = e.touches.length === 2 ? touchPair(e) : null;
    };
    const onTouchMove = (e: TouchEvent) => {
        if (!pinch || e.touches.length !== 2 || !e.cancelable) return;
        e.preventDefault();
        const now = touchPair(e);
        scroller.scrollLeft -= now.x - pinch.x;
        scroller.scrollTop -= now.y - pinch.y;
        if (pinch.distance > 0) zoomBy(now.distance / pinch.distance, now.x, now.y);
        pinch = now;
    };
    const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) pinch = null;
    };

    // ---------- pages: which to draw ----------

    const near = new Set<Slot>();
    const slotOf = new WeakMap<Element, Slot>();
    let nearObserver: IntersectionObserver | undefined;
    let visibleObserver: IntersectionObserver | undefined;
    let keepObserver: IntersectionObserver | undefined;

    onMount(() => {
        // drawn ahead: a screen above and below
        nearObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const slot = slotOf.get(entry.target);
                    if (!slot) continue;
                    slot.near = entry.isIntersecting;
                    if (slot.near) near.add(slot);
                    else {
                        near.delete(slot);
                        stopJob(slot);
                    }
                }
                schedule();
            },
            { root: scroller, rootMargin: "100% 0px" },
        );
        // drawn first: on screen now
        visibleObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const slot = slotOf.get(entry.target);
                    if (slot) slot.visible = entry.isIntersecting;
                }
                schedule();
            },
            { root: scroller },
        );
        // kept: within a screen and a half; past that a page's canvas and text are
        // freed, so a long document holds a few screens of pixels at most
        keepObserver = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const slot = slotOf.get(entry.target);
                    if (slot && !entry.isIntersecting) free(slot);
                }
            },
            { root: scroller, rootMargin: "150% 0px" },
        );
        onCleanup(() => {
            nearObserver?.disconnect();
            visibleObserver?.disconnect();
            keepObserver?.disconnect();
        });

        scroller.addEventListener("wheel", onWheel, { passive: false });
        scroller.addEventListener("touchmove", onTouchMove, { passive: false });
        onCleanup(() => {
            scroller.removeEventListener("wheel", onWheel);
            scroller.removeEventListener("touchmove", onTouchMove);
        });

        // a fitted document keeps fitting as the viewer resizes
        let width = scroller.clientWidth;
        const resize = new ResizeObserver(() => {
            if (scroller.clientWidth === width) return;
            width = scroller.clientWidth;
            if (fitting() && slots.length) zoomTo(fitZoom(pages), viewPoint(true));
        });
        resize.observe(scroller);
        onCleanup(() => resize.disconnect());
    });

    const attach = (slot: Slot, el: HTMLDivElement) => {
        slot.el = el;
        slotOf.set(el, slot);
        nearObserver?.observe(el);
        visibleObserver?.observe(el);
        keepObserver?.observe(el);
        onCleanup(() => {
            nearObserver?.unobserve(el);
            visibleObserver?.unobserve(el);
            keepObserver?.unobserve(el);
        });
    };

    let scheduled = false;
    let drawing = 0;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(pump);
    };

    const wanted = (slot: Slot) => slot.near && !slot.job && !pages[slot.index]?.failed && slot.drawnZoom !== drawZoom;

    /** Starts drawing the pages that most need it: on screen first, nearest the current page next. */
    const pump = () => {
        scheduled = false;
        // a gesture draws nothing until it rests: the transform shows the old drawings
        if (gesture) return;
        while (drawing < MAX_RENDERS && doc) {
            let best: Slot | undefined;
            let bestScore = Infinity;
            const here = current() - 1;
            for (const slot of near) {
                if (!wanted(slot)) continue;
                const score = (slot.visible ? 0 : slots.length) + Math.abs(slot.index - here);
                if (score < bestScore) {
                    best = slot;
                    bestScore = score;
                }
            }
            if (!best) return;
            void draw(best);
        }
    };

    const stopJob = (slot: Slot) => {
        if (!slot.job) return;
        slot.job.cancelled = true;
        slot.job.task?.cancel();
        slot.job = undefined;
    };

    /** Drops a far page's pixels and text; it is drawn again when it comes near. */
    const free = (slot: Slot) => {
        if (!slot.job && !slot.canvas && !slot.text) return;
        stopJob(slot);
        if (slot.canvas) release(slot.canvas);
        slot.canvas = undefined;
        slot.drawnZoom = 0;
        if (slot.text) {
            slot.text.layer.cancel();
            slot.text.div.remove();
            slot.text = undefined;
        }
        const pdf = doc;
        // pdf.js keeps each drawn page's operator list; let it go too
        void pdf?.getPage(slot.index + 1).then(
            (page) => page.cleanup(),
            () => {}, // quiet: a page that never opened has nothing to clean up
        );
    };

    /** The device pixels per CSS pixel a page is drawn at, held under MAX_CANVAS_PIXELS. */
    const pixelRatio = (cssWidth: number, cssHeight: number) => {
        const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
        const area = cssWidth * cssHeight * ratio * ratio;
        return area > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)) : ratio;
    };

    const draw = async (slot: Slot) => {
        const pdf = doc;
        const gen = generation;
        if (!pdf) return;
        const job: Job = { cancelled: false };
        slot.job = job;
        drawing++;
        const target = drawZoom;
        try {
            const page = await pdf.getPage(slot.index + 1);
            if (job.cancelled) return;
            const viewport = page.getViewport({ scale: target * CSS_UNITS });
            const ratio = pixelRatio(viewport.width, viewport.height);
            // a new canvas, swapped in when it's finished, so the old drawing
            // stays on screen (stretched) until the sharp one is ready
            const canvas = document.createElement("canvas");
            canvas.className = styles.canvas;
            canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
            canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
            job.task = page.render({
                canvas,
                viewport,
                transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
            });
            try {
                await job.task.promise;
            } catch (err) {
                release(canvas);
                throw err;
            }
            if (job.cancelled || !slot.el) {
                release(canvas);
                return;
            }
            if (slot.canvas) release(slot.canvas);
            slot.el.prepend(canvas);
            slot.canvas = canvas;
            slot.drawnZoom = target;
            if (!slot.text) showText(slot, page, viewport);
            // the rest of the pages are measured once the first drawing is up
            void sizeAll();
        } catch (err) {
            // quiet: a page that scrolled away, or a document that closed, stops drawing on purpose
            if (job.cancelled || gen !== generation || isCancellation(err)) return;
            setPages(slot.index, "failed", true);
            props.onPageError(`Can't show page ${slot.index + 1}`);
        } finally {
            if (slot.job === job) slot.job = undefined;
            drawing--;
            schedule();
        }
    };

    /** Lays the page's text over its canvas, invisible, so it can be selected and copied. */
    const showText = (slot: Slot, page: PDFPageProxy, viewport: ReturnType<PDFPageProxy["getViewport"]>) => {
        const el = slot.el;
        if (!el) return;
        const div = document.createElement("div");
        div.className = styles.textLayer;
        el.append(div);
        const layer = new TextLayer({
            textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
            container: div,
            viewport,
        });
        slot.text = { layer, div };
        const gen = generation;
        layer.render().then(
            () => {
                // a selection dragged past the last line ends here instead of
                // jumping to the page's top (see .selecting)
                const end = document.createElement("div");
                end.className = styles.endOfContent;
                div.append(end);
            },
            (err: unknown) => {
                // quiet: text that stopped loading because its page was freed
                if (gen !== generation || slot.text?.layer !== layer || isCancellation(err)) return;
                div.remove();
                slot.text = undefined;
                setPages(slot.index, "failed", true);
                props.onPageError(`Can't show page ${slot.index + 1}`);
            },
        );
    };

    // ---------- scrolling and keys ----------

    let scrollFrame = 0;
    onCleanup(() => cancelAnimationFrame(scrollFrame));
    const onScroll = () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            if (slots.length === 0) return;
            const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
            const page = scroller.scrollTop <= 0 ? 0 : atEnd ? slots.length - 1 : pageAtY(scroller.scrollTop + scroller.clientHeight / 2);
            setCurrent(page + 1);
        });
    };

    /** Scrolls page `index` (from 0) to the top. */
    const goTo = (index: number) => {
        const el = slots[Math.max(0, Math.min(slots.length - 1, index))]?.el;
        if (!el) return;
        scroller.scrollTop = el.offsetTop - parseFloat(getComputedStyle(column).paddingTop);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        // ⌘ or Ctrl with a key is the app's or the browser's (its own zoom, its own find)
        if (e.altKey || e.ctrlKey || e.metaKey || slots.length === 0) return;
        const top = scroller.scrollTop + parseFloat(getComputedStyle(column).paddingTop);
        // the page whose top is at the window's top, or the one it's inside
        const at = pageAtY(top + 1);
        switch (e.key) {
            case "PageDown":
                goTo(at + 1);
                break;
            case "PageUp":
                goTo((slots[at].el?.offsetTop ?? 0) < top - 1 ? at : at - 1);
                break;
            case "Home":
                goTo(0);
                break;
            case "End":
                scroller.scrollTop = scroller.scrollHeight;
                break;
            case "+":
            case "=":
                zoomIn();
                break;
            case "-":
                zoomOut();
                break;
            case "0":
                fitWidth();
                break;
            default:
                return;
        }
        e.preventDefault();
    };

    // copied text reads as text: ligatures and other presentation forms
    // become plain letters
    const onCopy = (e: ClipboardEvent) => {
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed || !e.clipboardData) return;
        e.clipboardData.setData("text/plain", normalizeUnicode(selection.toString()).replaceAll("\0", ""));
        e.preventDefault();
    };

    // while a selection is dragged, the page's text layer marks it so an
    // overshoot lands on the end of the page's text (pdf.js's own trick)
    const onPointerDown = (e: PointerEvent) => {
        const layer = (e.target as Element).closest(`.${styles.textLayer}`);
        if (!layer) return;
        layer.classList.add(styles.selecting);
        const done = () => {
            layer.classList.remove(styles.selecting);
            window.removeEventListener("pointerup", done);
            window.removeEventListener("blur", done);
        };
        window.addEventListener("pointerup", done);
        window.addEventListener("blur", done);
    };

    const percent = () => Math.round(shownZoom() * 100);

    return (
        <>
            <div
                ref={scroller}
                class={styles.scroller}
                classList={{ [styles.withControls]: props.controls }}
                role="document"
                tabIndex={0}
                onScroll={onScroll}
                onKeyDown={onKeyDown}
                onCopy={onCopy}
                onPointerDown={onPointerDown}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchEnd}
            >
                <div ref={stage} class={styles.stage}>
                <div
                    ref={column}
                    class={styles.pages}
                    style={{
                        "--paper-pdf-scale": String(zoom() * CSS_UNITS),
                        // pdf.js's text layer rounds its box down to this
                        // unit, and the pages round theirs the same way
                        "--scale-round-x": "1px",
                        "--scale-round-y": "1px",
                    }}
                >
                    <Show when={docKey()} keyed>
                        {(_document) => (
                            <Index each={pages}>
                                {(size, index) => {
                                    const slot = slots[index];
                                    return (
                                        <div
                                            ref={(el) => attach(slot, el)}
                                            class={styles.page}
                                            classList={{ [styles.failed]: size().failed }}
                                            data-page={index + 1}
                                            style={{
                                                "--paper-pdf-width": `${size().width}px`,
                                                "--paper-pdf-height": `${size().height}px`,
                                                "--paper-pdf-unit": String(size().unit),
                                            }}
                                        >
                                            <Show when={size().failed}>
                                                <PaperEmptyState class={styles.pageError} icon="error" role="alert" title={`Can't show page ${index + 1}`} />
                                            </Show>
                                        </div>
                                    );
                                }}
                            </Index>
                        )}
                    </Show>
                </div>
                </div>
            </div>
            <Show when={props.controls && docKey()}>
                <PaperPreviewControls aria-label="Zoom and pages">
                    <PaperButton icon variant="text" size="small" aria-label="Zoom out" disabled={shownZoom() <= PDF_MIN_ZOOM} onClick={zoomOut}>
                        <PaperIcon>remove</PaperIcon>
                    </PaperButton>
                    <PaperPreviewReadout aria-live="polite" title="Zoom">{percent()}%</PaperPreviewReadout>
                    <PaperButton icon variant="text" size="small" aria-label="Zoom in" disabled={shownZoom() >= PDF_MAX_ZOOM} onClick={zoomIn}>
                        <PaperIcon>add</PaperIcon>
                    </PaperButton>
                    <PaperButton icon variant="text" size="small" aria-label="Fit width" disabled={fitting()} onClick={fitWidth}>
                        <PaperIcon>fit_width</PaperIcon>
                    </PaperButton>
                    <span class={styles.divider} aria-hidden="true" />
                    <PaperPreviewReadout title="Page">
                        {current()} / {pages.length}
                    </PaperPreviewReadout>
                </PaperPreviewControls>
            </Show>
        </>
    );
}
