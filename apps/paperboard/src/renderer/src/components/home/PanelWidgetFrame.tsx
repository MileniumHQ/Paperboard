import { PaperButton, PaperText } from "@mileniumhq/paperui";
import { type Component, createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { WidgetSize } from "@mileniumhq/paperapi";
import { panelUrl } from "../../lib/shell";
import type { LoadQueue } from "../../lib/loadQueue";
import styles from "./Home.module.css";

// A widget that never answers the readiness challenge is a failure the
// user can see and retry, the same budget a panel frame gets.
const READY_TIMEOUT_MS = 25_000;

export interface PanelWidgetFrameProps {
    computerId: string;
    panelId: string;
    widgetId: string;
    /** a tile's item id, or a gallery preview's own id */
    instanceId: string;
    size: WidgetSize;
    /** the widget is on screen and should animate */
    visible: boolean;
    label: string;
    queue: LoadQueue;
    /** absent in gallery previews, which don't navigate */
    onOpenPanel?: () => void;
}

// One panel widget: the panel's widget.html in a frame, through the
// readiness handshake, waiting its turn in the shared load queue.
const PanelWidgetFrame: Component<PanelWidgetFrameProps> = (props) => {
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
            else if (event.data.type === "paperboard:widget-open-panel") props.onOpenPanel?.();
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

export default PanelWidgetFrame;
