import styles from "./viewers.module.css";
import { Failure } from "./Failure";
import { batch, createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { PaperButton } from "../../../components/PaperButton";
import { PaperIcon } from "../../../components/PaperIcon";
import { PaperLoader } from "../../../components/PaperLoader";
import { PaperPreviewControls, PaperPreviewReadout, previewHost } from "../controls";
import { cx } from "../../../utils/cx";

const MAX_ZOOM = 16;
// a wheel notch, a pinch step and a button press each multiply the zoom by about this much
const STEP = 1.25;

interface View {
    /** the image's scale relative to its fitted size; 1 fits it */
    scale: number;
    /** how far the image's centre sits from the frame's centre, in screen px */
    x: number;
    y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * A picture fitted to the frame, never past its own size, that zooms toward
 * where it's pinched, scrolled with ⌘ or Ctrl, or double-clicked, and pans
 * by dragging once it's bigger than the frame. +, − and 0 zoom from the keys.
 */
export function ImageView(props: { src: string; name: string; controls: boolean; onError: (message: string) => void }) {
    let frame!: HTMLDivElement;
    let img!: HTMLImageElement;
    const [loaded, setLoaded] = createSignal(false);
    const [failed, setFailed] = createSignal<string | null>(null);
    const [view, setView] = createSignal<View>(FIT);
    // the fitted size: the picture's own, shrunk to the frame
    const [fitted, setFitted] = createSignal({ width: 0, height: 0, natural: 1 });
    const [dragging, setDragging] = createSignal(false);

    // a new picture starts fitted, and loading
    createEffect(
        on(
            () => props.src,
            () => {
                batch(() => {
                    setLoaded(false);
                    setFailed(null);
                    setView(FIT);
                });
            },
            { defer: true },
        ),
    );

    const measure = () => {
        if (!img.complete || !frame) return;
        const box = frame.getBoundingClientRect();
        // an SVG with no size of its own is drawn as big as the frame
        const width = img.naturalWidth || box.width;
        const height = img.naturalHeight || box.height;
        if (!width || !height) return;
        const fit = Math.min(1, box.width / width, box.height / height);
        setFitted({ width: width * fit, height: height * fit, natural: fit });
        setView((v) => clamp(v));
    };

    onMount(() => {
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        onCleanup(() => observer.disconnect());
    });

    /** keeps the picture's edges from leaving the frame's middle */
    const clamp = (v: View): View => {
        const scale = Math.min(Math.max(v.scale, 1), MAX_ZOOM / Math.max(fitted().natural, 1e-6));
        const box = frame?.getBoundingClientRect();
        if (!box) return { ...v, scale };
        const spareX = Math.max(0, (fitted().width * scale - box.width) / 2);
        const spareY = Math.max(0, (fitted().height * scale - box.height) / 2);
        return { scale, x: Math.min(spareX, Math.max(-spareX, v.x)), y: Math.min(spareY, Math.max(-spareY, v.y)) };
    };

    /** zooms by `factor`, keeping the point under (clientX, clientY) where it is */
    const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
        const box = frame.getBoundingClientRect();
        const px = (clientX ?? box.left + box.width / 2) - (box.left + box.width / 2);
        const py = (clientY ?? box.top + box.height / 2) - (box.top + box.height / 2);
        setView((v) => {
            const next = clamp({ ...v, scale: v.scale * factor });
            const ratio = next.scale / v.scale;
            return clamp({ scale: next.scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio });
        });
    };

    /** the zoom against the picture's own pixels, as people read it */
    const percent = () => Math.round(view().scale * fitted().natural * 100);
    const actualSize = () => 1 / Math.max(fitted().natural, 1e-6);

    const pointers = new Map<number, { x: number; y: number }>();
    // a scroll or pinch follows the fingers without easing, until it rests
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(liveTimer));
    const live = () => {
        setDragging(true);
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => pointers.size === 0 && setDragging(false), 160);
    };

    const onWheel = (e: WheelEvent) => {
        // a trackpad pinch arrives as a wheel with ctrlKey; ⌘ or Ctrl with a wheel zooms too
        if (!e.ctrlKey && !e.metaKey) {
            if (view().scale > 1) {
                e.preventDefault();
                live();
                setView((v) => clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
            }
            return;
        }
        e.preventDefault();
        live();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };

    // drags pan, two touches pinch
    let pinchFrom = 0;
    // the zoom buttons float over the picture: pressing them is not a pan
    const onControls = (e: Event) => e.target instanceof Element && e.target.closest('[role="toolbar"]') !== null;

    const onPointerDown = (e: PointerEvent) => {
        if (!loaded() || e.button !== 0 || onControls(e)) return;
        frame.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchFrom = Math.hypot(a.x - b.x, a.y - b.y);
        }
        setDragging(view().scale > 1 || pointers.size === 2);
    };
    const onPointerMove = (e: PointerEvent) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        const now = { x: e.clientX, y: e.clientY };
        pointers.set(e.pointerId, now);
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchFrom > 0) zoomAt(distance / pinchFrom, (a.x + b.x) / 2, (a.y + b.y) / 2);
            pinchFrom = distance;
            return;
        }
        if (view().scale > 1) setView((v) => clamp({ ...v, x: v.x + now.x - last.x, y: v.y + now.y - last.y }));
    };
    const onPointerUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchFrom = 0;
        if (pointers.size === 0) setDragging(false);
    };

    // a double click goes to the picture's own size there, or back to fitted
    const onDoubleClick = (e: MouseEvent) => {
        if (!loaded() || onControls(e)) return;
        if (view().scale > 1) return setView(FIT);
        zoomAt(Math.max(actualSize(), 2), e.clientX, e.clientY);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "+" || e.key === "=") zoomAt(STEP);
        else if (e.key === "-") zoomAt(1 / STEP);
        else if (e.key === "0") setView(FIT);
        else return;
        e.preventDefault();
    };

    const fail = () => {
        const message = `${props.name} couldn't be shown: the picture is damaged or in a format this browser can't open`;
        setFailed(message);
        props.onError(message);
    };

    return (
        <div
            ref={frame}
            class={cx(previewHost, styles.imageFrame)}
            classList={{ [styles.zoomed]: view().scale > 1, [styles.dragging]: dragging() }}
            tabIndex={0}
            aria-label={props.name}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDblClick={onDoubleClick}
            onKeyDown={onKeyDown}
        >
            <Show when={!failed()} fallback={<Failure icon="broken_image" title={failed()!} />}>
                <img
                    ref={img}
                    class={styles.image}
                    classList={{ [styles.pixelated]: view().scale * fitted().natural >= 4, [styles.hidden]: !loaded() }}
                    src={props.src}
                    alt={props.name}
                    draggable={false}
                    decoding="async"
                    style={{
                        width: fitted().width ? `${fitted().width}px` : undefined,
                        height: fitted().height ? `${fitted().height}px` : undefined,
                        transform: `translate(${view().x}px, ${view().y}px) scale(${view().scale})`,
                    }}
                    onLoad={() => {
                        measure();
                        setLoaded(true);
                    }}
                    onError={fail}
                />
                <Show when={!loaded()}>
                    <PaperLoader class={styles.centered} loaderStatus="indeterminate" delay={150} label={`Loading ${props.name}`} />
                </Show>
                <Show when={props.controls && loaded()}>
                    <PaperPreviewControls aria-label="Zoom">
                        <PaperButton icon variant="text" size="small" aria-label="Zoom out" disabled={view().scale <= 1} onClick={() => zoomAt(1 / STEP)}>
                            <PaperIcon>remove</PaperIcon>
                        </PaperButton>
                        <PaperPreviewReadout aria-live="polite">{percent()}%</PaperPreviewReadout>
                        <PaperButton
                            icon
                            variant="text"
                            size="small"
                            aria-label="Zoom in"
                            disabled={view().scale * fitted().natural >= MAX_ZOOM}
                            onClick={() => zoomAt(STEP)}
                        >
                            <PaperIcon>add</PaperIcon>
                        </PaperButton>
                        <PaperButton icon variant="text" size="small" aria-label="Fit" disabled={view().scale === 1} onClick={() => setView(FIT)}>
                            <PaperIcon>fit_screen</PaperIcon>
                        </PaperButton>
                    </PaperPreviewControls>
                </Show>
            </Show>
        </div>
    );
}
