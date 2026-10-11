import { PaperButton, PaperIcon, PaperText } from "@mileniumhq/paperui";
import { type Component, createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { parseWidgetSize, type PanelItem, type WidgetDeclaration } from "@mileniumhq/paperapi";
import { type ComputerInfo, panelUrl } from "../../lib/shell";
import type { LoadQueue } from "../../lib/loadQueue";
import { BUILTIN_WIDGETS, BuiltinView, builtinWidget } from "./builtins";
import PanelWidgetFrame from "./PanelWidgetFrame";
import styles from "./Home.module.css";

/** One widget, at one size, ready to place. */
export type LibraryEntry = {
    computerId: string;
    widget: WidgetDeclaration;
    size: string;
    /** where it comes from, as people know it: "Paperboard" or the panel's name */
    sourceName: string;
} & ({ source: "builtin" } | { source: "panel"; panelId: string });

export function sizeLabel(size: string): string {
    return size.replace("x", "×");
}

// previews are the real widget, drawn at Home's cell size and scaled to this
// previews fill the card's width, up to a cell this big
const PREVIEW_CELL = 88;
const PREVIEW_WIDTH = 256;

type Source =
    | { key: "paperboard"; kind: "builtin" }
    | { key: string; kind: "panel"; computer: ComputerInfo; panel: PanelItem };

export interface WidgetLibraryProps {
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    full: boolean;
    /** Home's cell size, so a preview is drawn exactly as it will look */
    cell: number;
    inset: number;
    queue: LoadQueue;
    panelName: (computerId: string, panelId: string) => string;
    onRetry: (computerId: string) => void;
    onStartDrag: (entry: LibraryEntry, event: PointerEvent) => void;
    onAdd: (entry: LibraryEntry) => void;
    onDone: () => void;
}

// The widget gallery, on the right while Home is being edited: first
// where widgets come from (Paperboard, then each panel), then that
// source's widgets as live previews. Pick a size, then drag a preview onto
// Home or press it to drop it in the first free spot.
const WidgetLibrary: Component<WidgetLibraryProps> = (props) => {
    const [openKey, setOpenKey] = createSignal<string | null>(null);
    const localId = () => props.computers.find((c) => c.isLocal)?.id ?? props.computers[0]?.id ?? "local";
    const [chosenComputer, setChosenComputer] = createSignal<string | null>(null);
    // the computer CPU and Memory show; this one unless another was picked
    const builtinComputer = () => {
        const chosen = chosenComputer();
        return chosen && props.computers.some((c) => c.id === chosen) ? chosen : localId();
    };

    const panelSources = (computer: ComputerInfo): Source[] =>
        (props.panelsByComputer[computer.id] ?? [])
            .filter((panel) => (panel.widgets?.length ?? 0) > 0)
            .map((panel) => ({ key: `${computer.id}::${panel.id}`, kind: "panel" as const, computer, panel }));
    const open = createMemo<Source | null>(() => {
        const key = openKey();
        if (!key) return null;
        if (key === "paperboard") return { key: "paperboard", kind: "builtin" };
        for (const computer of props.computers) {
            const found = panelSources(computer).find((s) => s.key === key);
            if (found) return found;
        }
        return null;
    });
    let backButton: HTMLButtonElement | undefined;
    let listTop: HTMLDivElement | undefined;
    const openSource = (key: string) => {
        setOpenKey(key);
        queueMicrotask(() => backButton?.focus());
    };
    const closeSource = () => {
        const key = openKey();
        setOpenKey(null);
        // focus returns to the source that was opened
        queueMicrotask(() => listTop?.querySelector<HTMLElement>(`[data-source="${CSS.escape(key ?? "")}"]`)?.focus());
    };

    return (
        <aside class={styles.library} aria-label="Widget gallery">
            <div class={styles.libraryHeader}>
                <Show
                    when={open()}
                    fallback={<PaperText size={3} weight={800}>Widgets</PaperText>}
                >
                    <PaperButton ref={backButton} size="small" variant="text" onClick={closeSource} aria-label="Back to all widgets">
                        <PaperIcon>arrow_back</PaperIcon> Widgets
                    </PaperButton>
                </Show>
                <PaperButton size="small" variant="primary" onClick={props.onDone}>Done</PaperButton>
            </div>
            <Show when={props.full}>
                <PaperText size={1} color="text-subtle" class={styles.libraryNote}>
                    Home is full. Remove a widget to add another.
                </PaperText>
            </Show>

            <Show
                when={open()}
                fallback={
                    <div ref={listTop} class={styles.libraryList}>
                        <SourceRow
                            key="paperboard"
                            icon={<PaperIcon>widgets</PaperIcon>}
                            name="Paperboard"
                            detail={BUILTIN_WIDGETS.map((w) => w.declaration.name).join(", ")}
                            onOpen={openSource}
                        />
                        <For each={props.computers}>
                            {(computer) => (
                                <>
                                    <Show when={props.computers.length > 1 && (panelSources(computer).length > 0 || props.panelsLoadFailed[computer.id])}>
                                        <PaperText size={1} weight={700} color="text-subtle" class={styles.libraryComputer}>
                                            {computer.name}
                                        </PaperText>
                                    </Show>
                                    <Show when={props.panelsLoadFailed[computer.id]}>
                                        <div class={styles.libraryNote}>
                                            <PaperText size={1} color="text-subtle">Couldn't load widgets from {computer.name}.</PaperText>
                                            <PaperButton size="tiny" variant="text" onClick={() => props.onRetry(computer.id)}>Retry</PaperButton>
                                        </div>
                                    </Show>
                                    <For each={panelSources(computer)}>
                                        {(source) => {
                                            const s = source as Extract<Source, { kind: "panel" }>;
                                            return (
                                                <SourceRow
                                                    key={s.key}
                                                    icon={<PanelIcon computerId={computer.id} panel={s.panel} />}
                                                    name={s.panel.name}
                                                    detail={(s.panel.widgets ?? []).map((w) => w.name).join(", ")}
                                                    onOpen={openSource}
                                                />
                                            );
                                        }}
                                    </For>
                                </>
                            )}
                        </For>
                    </div>
                }
            >
                {(source) => (
                    <div class={styles.libraryList}>
                        <div class={styles.sourceTitle}>
                            <Show
                                when={source().kind === "panel" ? (source() as Extract<Source, { kind: "panel" }>) : null}
                                fallback={<PaperIcon>widgets</PaperIcon>}
                            >
                                {(s) => <PanelIcon computerId={s().computer.id} panel={s().panel} />}
                            </Show>
                            <PaperText size={4} weight={800}>
                                {source().kind === "panel" ? (source() as Extract<Source, { kind: "panel" }>).panel.name : "Paperboard"}
                            </PaperText>
                        </div>
                        <PaperText size={1} color="text-subtle">Pick a size, then drag a widget onto Home or click it to add it.</PaperText>
                        <Show when={source().kind === "builtin" && props.computers.length > 1}>
                            <div class={styles.chipRow} role="group" aria-label="CPU and Memory show">
                                <For each={props.computers}>
                                    {(computer) => (
                                        <button
                                            type="button"
                                            class={styles.chip}
                                            aria-pressed={builtinComputer() === computer.id}
                                            onClick={() => setChosenComputer(computer.id)}
                                        >
                                            {computer.name}
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                        <For
                            each={
                                source().kind === "builtin"
                                    ? BUILTIN_WIDGETS.map((w) => w.declaration)
                                    : ((source() as Extract<Source, { kind: "panel" }>).panel.widgets ?? [])
                            }
                        >
                            {(widget) => {
                                const s = source();
                                const entryAt = (size: string): LibraryEntry =>
                                    s.kind === "builtin"
                                        ? {
                                              source: "builtin",
                                              computerId: builtinWidget(widget.id)?.perComputer ? builtinComputer() : localId(),
                                              widget,
                                              size,
                                              sourceName: "Paperboard",
                                          }
                                        : {
                                              source: "panel",
                                              computerId: s.computer.id,
                                              panelId: s.panel.id,
                                              widget,
                                              size,
                                              sourceName: s.panel.name,
                                          };
                                return <WidgetCard {...props} widget={widget} entryAt={entryAt} />;
                            }}
                        </For>
                    </div>
                )}
            </Show>
        </aside>
    );
};

const SourceRow: Component<{ key: string; icon: JSX.Element; name: string; detail: string; onOpen: (key: string) => void }> = (props) => (
    <button type="button" class={styles.sourceRow} data-source={props.key} onClick={() => props.onOpen(props.key)}>
        <span class={styles.sourceIcon}>{props.icon}</span>
        <span class={styles.libraryItemText}>
            <PaperText size={2} weight={700}>{props.name}</PaperText>
            <PaperText size={1} color="text-subtle" class={styles.sourceDetail}>{props.detail}</PaperText>
        </span>
        <PaperIcon aria-hidden="true">chevron_right</PaperIcon>
    </button>
);

const PanelIcon: Component<{ computerId: string; panel: PanelItem }> = (props) => {
    const src = () =>
        props.panel.iconUrl ?? (props.panel.icon?.includes(".") ? panelUrl(props.computerId, props.panel.id, props.panel.icon) : undefined);
    return (
        <PaperIcon src={src()} alt="">
            {props.panel.icon && !props.panel.icon.includes(".") ? props.panel.icon : "dashboard"}
        </PaperIcon>
    );
};

const WidgetCard: Component<WidgetLibraryProps & { widget: WidgetDeclaration; entryAt: (size: string) => LibraryEntry }> = (props) => {
    const [size, setSize] = createSignal(props.widget.sizes[0]);
    const parsed = () => parseWidgetSize(size()) ?? { w: 1, h: 1 };
    const tallest = () => Math.max(...props.widget.sizes.map((s) => parseWidgetSize(s)?.h ?? 1));
    const entry = () => props.entryAt(size());
    const previewCell = () => Math.min(PREVIEW_CELL, PREVIEW_WIDTH / Math.max(...props.widget.sizes.map((s) => parseWidgetSize(s)?.w ?? 1)));
    const scale = () => previewCell() / props.cell;
    const real = () => ({ w: parsed().w * props.cell - props.inset * 2, h: parsed().h * props.cell - props.inset * 2 });
    const previewId = `preview-${crypto.randomUUID()}`;
    const builtin = () => (entry().source === "builtin" ? builtinWidget(props.widget.id) : undefined);
    const computerName = () => props.computers.find((c) => c.id === entry().computerId)?.name ?? entry().computerId;

    return (
        <section class={styles.widgetCard} aria-label={props.widget.name}>
            <div class={styles.previewStage} style={{ height: `${tallest() * previewCell()}px` }}>
                <button
                    type="button"
                    class={styles.preview}
                    style={{ width: `${real().w * scale()}px`, height: `${real().h * scale()}px` }}
                    disabled={props.full}
                    aria-label={`Add ${props.widget.name}, ${sizeLabel(size())}`}
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
                    <div
                        class={styles.previewScaled}
                        style={{ width: `${real().w}px`, height: `${real().h}px`, transform: `scale(${scale()})` }}
                        aria-hidden="true"
                    >
                        <div class={styles.card}>
                            <Show
                                when={builtin()}
                                fallback={
                                    <Show when={entry().source === "panel" ? (entry() as Extract<LibraryEntry, { source: "panel" }>) : null}>
                                        {(panelEntry) => (
                                            <PanelWidgetFrame
                                                computerId={panelEntry().computerId}
                                                panelId={panelEntry().panelId}
                                                widgetId={props.widget.id}
                                                instanceId={previewId}
                                                size={parsed()}
                                                visible={true}
                                                label={`${props.widget.name} preview`}
                                                queue={props.queue}
                                            />
                                        )}
                                    </Show>
                                }
                            >
                                {(widget) => (
                                    <BuiltinView
                                        widget={widget()}
                                        computerId={entry().computerId}
                                        computerName={computerName()}
                                        showComputer={props.computers.length > 1}
                                        size={parsed()}
                                        visible={true}
                                        panelName={(panelId) => props.panelName(entry().computerId, panelId)}
                                    />
                                )}
                            </Show>
                        </div>
                    </div>
                    <span class={styles.addBadge} aria-hidden="true">
                        <PaperIcon>add</PaperIcon>
                    </span>
                </button>
            </div>
            <div class={styles.widgetCardText}>
                <PaperText size={2} weight={700}>{props.widget.name}</PaperText>
                <Show when={props.widget.description}>
                    <PaperText size={1} color="text-subtle">{props.widget.description}</PaperText>
                </Show>
            </div>
            <Show when={props.widget.sizes.length > 1}>
                <div class={styles.chipRow} role="group" aria-label={`${props.widget.name} size`}>
                    <For each={props.widget.sizes}>
                        {(option) => {
                            const shape = parseWidgetSize(option) ?? { w: 1, h: 1 };
                            return (
                                <button
                                    type="button"
                                    class={styles.chip}
                                    aria-pressed={size() === option}
                                    aria-label={sizeLabel(option)}
                                    onClick={() => setSize(option)}
                                >
                                    <span
                                        class={styles.sizeGlyph}
                                        style={{ width: `${shape.w * 0.375}rem`, height: `${shape.h * 0.375}rem` }}
                                        aria-hidden="true"
                                    />
                                    {sizeLabel(option)}
                                </button>
                            );
                        }}
                    </For>
                </div>
            </Show>
        </section>
    );
};

export default WidgetLibrary;
