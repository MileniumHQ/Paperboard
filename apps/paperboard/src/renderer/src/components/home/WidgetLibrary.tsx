import { PaperButton, PaperText } from "@mileniumhq/paperui";
import { type Component, For, Show } from "solid-js";
import type { PanelItem, WidgetDeclaration } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import styles from "./Home.module.css";

export interface LibraryEntry {
    computerId: string;
    panelId: string;
    panelName: string;
    widget: WidgetDeclaration;
}

export function sizeLabel(size: string): string {
    return size.replace("x", "×");
}

// The right-hand sidebar: every widget every paired computer offers.
// Drag one onto the grid, or press it to drop it in the first free spot.
const WidgetLibrary: Component<{
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    full: boolean;
    onRetry: (computerId: string) => void;
    onStartDrag: (entry: LibraryEntry, event: PointerEvent) => void;
    onAdd: (entry: LibraryEntry) => void;
    onDone: () => void;
}> = (props) => {
    const panelsWithWidgets = (computerId: string) =>
        (props.panelsByComputer[computerId] ?? []).filter((panel) => (panel.widgets?.length ?? 0) > 0);
    const anyWidgets = () => props.computers.some((comp) => panelsWithWidgets(comp.id).length > 0);

    return (
        <aside class={styles.library} aria-label="Widgets">
            <div class={styles.libraryHeader}>
                <PaperText size={3} weight={800}>Widgets</PaperText>
                <PaperButton size="small" variant="primary" onClick={props.onDone}>Done</PaperButton>
            </div>
            <Show when={props.full}>
                <PaperText size={1} color="text-subtle" class={styles.libraryNote}>
                    Home is full. Remove a widget to add another.
                </PaperText>
            </Show>
            <div class={styles.libraryList}>
                <For each={props.computers}>
                    {(comp) => (
                        <>
                            <Show when={props.computers.length > 1 && (panelsWithWidgets(comp.id).length > 0 || props.panelsLoadFailed[comp.id])}>
                                <PaperText size={1} weight={700} color="text-subtle" class={styles.libraryComputer}>
                                    {comp.name}
                                </PaperText>
                            </Show>
                            <Show when={props.panelsLoadFailed[comp.id]}>
                                <div class={styles.libraryNote}>
                                    <PaperText size={1} color="text-subtle">
                                        Couldn't load widgets from {comp.name}.
                                    </PaperText>
                                    <PaperButton size="tiny" variant="text" onClick={() => props.onRetry(comp.id)}>Retry</PaperButton>
                                </div>
                            </Show>
                            <For each={panelsWithWidgets(comp.id)}>
                                {(panel) => (
                                    <section class={styles.libraryPanel} aria-label={panel.name}>
                                        <PaperText size={2} weight={700}>{panel.name}</PaperText>
                                        <For each={panel.widgets}>
                                            {(widget) => {
                                                const entry = (): LibraryEntry => ({
                                                    computerId: comp.id,
                                                    panelId: panel.id,
                                                    panelName: panel.name,
                                                    widget,
                                                });
                                                return (
                                                    <button
                                                        type="button"
                                                        class={styles.libraryItem}
                                                        disabled={props.full}
                                                        aria-label={`Add ${widget.name} from ${panel.name}`}
                                                        onPointerDown={(e) => {
                                                            if (e.button === 0 && !props.full) props.onStartDrag(entry(), e);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                e.preventDefault();
                                                                props.onAdd(entry());
                                                            }
                                                        }}
                                                    >
                                                        <span class={styles.libraryItemText}>
                                                            <PaperText size={2}>{widget.name}</PaperText>
                                                            <Show when={widget.description}>
                                                                <PaperText size={1} color="text-subtle">{widget.description}</PaperText>
                                                            </Show>
                                                        </span>
                                                        <PaperText size={1} color="text-subtle">{sizeLabel(widget.sizes[0])}</PaperText>
                                                    </button>
                                                );
                                            }}
                                        </For>
                                    </section>
                                )}
                            </For>
                        </>
                    )}
                </For>
                <Show when={!anyWidgets() && !props.computers.some((c) => props.panelsLoadFailed[c.id])}>
                    <PaperText size={1} color="text-subtle" class={styles.libraryNote}>
                        None of your panels offer widgets yet.
                    </PaperText>
                </Show>
            </div>
        </aside>
    );
};

export default WidgetLibrary;
