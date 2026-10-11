import { PaperButton, PaperText } from "@mileniumhq/paperui";
import { type Component, type JSX, createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { WidgetSize } from "@mileniumhq/paperapi";
import { panelUrl } from "../../lib/shell";
import type { LoadQueue } from "../../lib/loadQueue";
import styles from "./Home.module.css";

// A widget that never answers the readiness challenge is a failure the
// user can see and retry, the same budget a panel frame gets.
const READY_TIMEOUT_MS = 25_000;

export type TileStatus =
    | { kind: "ok"; panelName: string; widgetName: string }
    | { kind: "waiting"; message: string }
    | { kind: "unavailable"; message: string; retry?: () => void };

export interface WidgetTileProps {
    instanceId: string;
    computerId: string;
    panelId: string;
    widgetId: string;
    size: WidgetSize;
    status: TileStatus;
    /** a frame may exist: in view recently and Home not suspended */
    live: boolean;
    /** Home is showing and this tile is in view; the widget should animate */
    visible: boolean;
    editing: boolean;
    selected: boolean;
    lifted: boolean;
    queue: LoadQueue;
    style: JSX.CSSProperties;
    label: string;
    sizeLabel: string;
    canResize: boolean;
    ref: (el: HTMLDivElement) => void;
    onOpenPanel: () => void;
    onRemove: () => void;
    onCycleSize: () => void;
    onPointerDown: (event: PointerEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    onFocus: () => void;
}

const WidgetFrame: Component<{
    props: WidgetTileProps;
}> = (outer) => {
    const props = outer.props;
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let generation = "";
    let stop: (() => void) | null = null;

    const post = (message: Record<string, unknown>) =>
        frame?.contentWindow?.postMessage({ ...message, generation }, "*");

    const start = () => {
        stop?.();
        setReady(false);
        setFailure("");
        generation = crypto.randomUUID();
        const mine = generation;
        const slot = props.queue.acquire();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (error?: string) => {
            clearTimeout(timer);
            slot.release();
            if (error) setFailure(error);
            else setReady(true);
        };
        const receive = (event: MessageEvent) => {
            if (event.source !== frame?.contentWindow || event.data?.generation !== mine) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === props.panelId) settle();
            else if (event.data.type === "paperboard:failed") settle(String(event.data.message || "The widget failed to start"));
            else if (event.data.type === "paperboard:widget-open-panel") props.onOpenPanel();
        };
        window.addEventListener("message", receive);
        void slot.granted.then(() => {
            if (generation !== mine || !frame) return;
            timer = setTimeout(() => settle("The widget did not finish connecting to its panel's service."), READY_TIMEOUT_MS);
            frame.src = panelUrl(props.computerId, props.panelId, `widget.html?generation=${mine}`);
        });
        stop = () => {
            clearTimeout(timer);
            slot.release();
            window.removeEventListener("message", receive);
        };
    };

    onMount(start);
    onCleanup(() => stop?.());

    // the shell owns size and visibility; the widget follows
    createEffect(() => {
        const size = props.size;
        const visible = props.visible;
        if (ready()) post({ type: "paperboard:widget-update", size, visible });
    });

    return (
        <>
            <iframe
                ref={frame}
                class={styles.frame}
                title={props.label}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style={{ opacity: ready() && !failure() ? "1" : "0" }}
                onLoad={() => {
                    if (!frame?.src) return;
                    post({
                        type: "paperboard:initialize",
                        widget: { id: props.widgetId, instanceId: props.instanceId, size: props.size, visible: props.visible },
                    });
                }}
            />
            <Show when={failure()}>
                <div class={styles.tileStatus} role="alert">
                    <PaperText size={1} color="text-subtle">{failure()}</PaperText>
                    <PaperButton size="tiny" variant="text" onClick={start}>Reload widget</PaperButton>
                </div>
            </Show>
        </>
    );
};

const WidgetTile: Component<WidgetTileProps> = (props) => {
    const status = () => props.status;
    return (
        <div
            ref={props.ref}
            class={styles.tile}
            classList={{ [styles.lifted]: props.lifted, [styles.selected]: props.selected && props.editing }}
            style={props.style}
            data-home-item={props.instanceId}
        >
            <div class={styles.card}>
                <Show
                    when={status().kind === "ok"}
                    fallback={
                        <div class={styles.tileStatus} role={status().kind === "unavailable" ? "alert" : "status"}>
                            <PaperText size={1} color="text-subtle">
                                {(status() as { message: string }).message}
                            </PaperText>
                            <Show when={status().kind === "unavailable" && (status() as { retry?: () => void }).retry}>
                                {(retry) => (
                                    <PaperButton size="tiny" variant="text" onClick={() => retry()()}>Retry</PaperButton>
                                )}
                            </Show>
                            <Show when={status().kind === "unavailable"}>
                                <PaperButton size="tiny" variant="text" onClick={props.onRemove}>Remove from Home</PaperButton>
                            </Show>
                        </div>
                    }
                >
                    <Show when={props.live}>
                        <WidgetFrame props={props} />
                    </Show>
                </Show>
            </div>
            <Show when={props.editing}>
                <div
                    class={styles.editOverlay}
                    tabindex="0"
                    role="button"
                    aria-roledescription="movable widget"
                    aria-label={`${props.label}, ${props.sizeLabel}. Drag or use arrow keys to move, Delete to remove.`}
                    onPointerDown={props.onPointerDown}
                    onKeyDown={props.onKeyDown}
                    onFocus={props.onFocus}
                >
                    <div class={styles.editBar}>
                        <PaperText size={1} weight={700} class={styles.editName}>{props.label}</PaperText>
                        <Show when={props.canResize}>
                            <PaperButton
                                size="tiny"
                                aria-label={`Change size, now ${props.sizeLabel}`}
                                onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                                onClick={props.onCycleSize}
                            >
                                {props.sizeLabel}
                            </PaperButton>
                        </Show>
                        <PaperButton
                            size="tiny"
                            icon
                            aria-label={`Remove ${props.label} from Home`}
                            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                            onClick={props.onRemove}
                        >
                            close
                        </PaperButton>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default WidgetTile;
