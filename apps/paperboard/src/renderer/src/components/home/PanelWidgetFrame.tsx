import { PaperButton, PaperText } from "@mileniumhq/paperui";
import { type Component, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { WidgetOptionValues, WidgetSize } from "@mileniumhq/paperapi";
import { panelUrl } from "../../lib/shell";
import type { LoadQueue } from "../../lib/loadQueue";
import styles from "./Home.module.css";

// A widget that never answers the readiness challenge is a failure the
// user can see and retry, the same budget a panel frame gets.
const READY_TIMEOUT_MS = 25_000;

/** What a panel's widget frames load against, from its installed manifest. */
export interface FrameFacts {
    service: boolean;
    revision: string;
}

export interface PanelWidgetFrameProps {
    computerId: string;
    panelId: string;
    widgetId: string;
    /** a tile's item id, or a gallery preview's own id */
    instanceId: string;
    size: WidgetSize;
    /** what was chosen in the gallery; read once, when the frame loads */
    options?: WidgetOptionValues;
    /** the panel runs a service, so readiness includes its hydration */
    service: boolean;
    /** changes when the panel is updated or restarted; the frame loads again */
    revision: string;
    /** the widget is on screen and should animate */
    visible: boolean;
    label: string;
    queue: LoadQueue;
    /** absent in gallery previews, which don't navigate */
    onOpenPanel?: () => void;
}

// One panel widget: the panel's widget.html in a frame, through the
// readiness handshake, waiting its turn in the shared load queue. Every
// document the frame loads is its own attempt: a fresh generation, a fresh
// deadline, and nothing shown until that document answers ready.
const PanelWidgetFrame: Component<PanelWidgetFrameProps> = (props) => {
    const [ready, setReady] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    let frame: HTMLIFrameElement | undefined;
    let attempt: { generation: string; cancelled: boolean; initialized: boolean; stop: () => void } | null = null;

    const post = (message: Record<string, unknown>) =>
        attempt && frame?.contentWindow?.postMessage({ ...message, generation: attempt.generation }, "*");

    const start = () => {
        attempt?.stop();
        setReady(false);
        setFailure("");
        const slot = props.queue.acquire();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const mine = {
            generation: crypto.randomUUID(),
            cancelled: false,
            initialized: false,
            stop: () => {
                mine.cancelled = true;
                clearTimeout(timer);
                slot.release();
                window.removeEventListener("message", receive);
            },
        };
        attempt = mine;
        const settle = (error?: string) => {
            if (mine.cancelled) return;
            clearTimeout(timer);
            slot.release();
            if (error) setFailure(error);
            else setReady(true);
        };
        const receive = (event: MessageEvent) => {
            if (mine.cancelled || event.source !== frame?.contentWindow || event.data?.generation !== mine.generation) return;
            if (event.data.type === "paperboard:ready" && event.data.panelId === props.panelId) settle();
            else if (event.data.type === "paperboard:failed") settle(String(event.data.message || "The widget failed to start"));
            else if (event.data.type === "paperboard:widget-open-panel") props.onOpenPanel?.();
        };
        window.addEventListener("message", receive);
        void slot.granted.then(() => {
            // released while waiting its turn: this frame is gone or replaced
            if (mine.cancelled || !frame) return;
            timer = setTimeout(() => settle("The widget did not finish connecting to its panel's service."), READY_TIMEOUT_MS);
            frame.src = panelUrl(props.computerId, props.panelId, `widget.html?generation=${mine.generation}`);
        });
    };

    onMount(start);
    onCleanup(() => {
        attempt?.stop();
        attempt = null;
    });
    // an updated or restarted panel is new code and a new service: load again.
    // The memo compares values: another panel's restart re-runs the revision
    // getter without changing this one's, and must not reload this frame.
    const revision = createMemo(() => props.revision);
    createEffect(on(revision, start, { defer: true }));

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
                    // a load of an earlier attempt's document, before this one's src is set
                    if (!frame?.src || !attempt || attempt.cancelled || !frame.src.includes(attempt.generation)) return;
                    // a second document in one attempt is a reload the shell
                    // didn't ask for: it starts over instead of keeping "ready"
                    if (attempt.initialized) return start();
                    attempt.initialized = true;
                    post({
                        type: "paperboard:initialize",
                        service: props.service,
                        widget: {
                            id: props.widgetId,
                            instanceId: props.instanceId,
                            size: props.size,
                            visible: props.visible,
                            options: props.options ?? {},
                        },
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
