import { PaperButton, PaperText } from "@mileniumhq/paperui";
import { type Component, type JSX, Show } from "solid-js";
import styles from "./Home.module.css";

export type TileStatus =
    | { kind: "ok" }
    | { kind: "waiting"; message: string }
    | { kind: "unavailable"; message: string; retry?: () => void };

// A placed widget's card: its content (a panel's frame or a built-in
// widget), what it shows when it can't, and the edit-mode controls.
export interface WidgetTileProps {
    instanceId: string;
    status: TileStatus;
    /** the content may exist: in view recently and Home not suspended */
    live: boolean;
    editing: boolean;
    selected: boolean;
    lifted: boolean;
    style: JSX.CSSProperties;
    label: string;
    sizeLabel: string;
    children: JSX.Element;
    ref: (el: HTMLDivElement) => void;
    onRemove: () => void;
    onPointerDown: (event: PointerEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    onFocus: () => void;
}

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
                    <Show when={props.live}>{props.children}</Show>
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
                    <PaperButton
                        size="tiny"
                        icon
                        class={styles.removeBadge}
                        aria-label={`Remove ${props.label} from Home`}
                        onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                        onClick={props.onRemove}
                    >
                        remove
                    </PaperButton>
                </div>
            </Show>
        </div>
    );
};

export default WidgetTile;
