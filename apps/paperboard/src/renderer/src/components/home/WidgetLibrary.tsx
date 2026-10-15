import {
    PaperButton,
    PaperCard,
    PaperChip,
    PaperIcon,
    PaperList,
    PaperListItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { type Component, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import {
    getWidgetChoices,
    parseWidgetSize,
    type PanelItem,
    type WidgetChoice,
    type WidgetDeclaration,
    type WidgetOptionValues,
} from "@mileniumhq/paperapi";
import { type ComputerInfo, logToMain, panelUrl } from "../../lib/shell";
import type { LoadQueue } from "../../lib/loadQueue";
import { BUILTIN_WIDGETS, BuiltinView, builtinWidget } from "./builtins";
import PanelWidgetFrame, { type FrameFacts } from "./PanelWidgetFrame";
import styles from "./Home.module.css";

/** One widget, at one size, ready to place. */
export type LibraryEntry = {
    computerId: string;
    widget: WidgetDeclaration;
    size: string;
    /** where it comes from, as people know it: "Paperboard" or the panel's name */
    sourceName: string;
    /** what the gallery's dropdowns say, when the widget declares options */
    options?: WidgetOptionValues;
} & ({ source: "builtin" } | { source: "panel"; panelId: string });

export function sizeLabel(size: string): string {
    return size.replace("x", "×");
}

// previews are the real widget, drawn at Home's cell size and scaled to this
// previews fill the card's width, up to a cell this big
const PREVIEW_CELL = 88;
const PREVIEW_WIDTH = 252;

type Source =
    | { key: "paperboard"; kind: "builtin" }
    | { key: string; kind: "panel"; computer: ComputerInfo; panel: PanelItem };

export interface WidgetLibraryProps {
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    full: boolean;
    /** Home is on screen; hidden previews stop ticking and polling */
    visible: boolean;
    /** Home's cell size, so a preview is drawn exactly as it will look */
    cell: number;
    inset: number;
    queue: LoadQueue;
    panelName: (computerId: string, panelId: string) => string;
    frameFacts: (computerId: string, panelId: string) => FrameFacts;
    onRetry: (computerId: string) => void;
    onStartDrag: (entry: LibraryEntry, event: PointerEvent) => void;
    onAdd: (entry: LibraryEntry) => void;
    onDone: () => void;
    /** the room the gallery takes from Home's right edge, in px */
    onWidth: (px: number) => void;
}

// The widget gallery, floating on the right while Home is being edited:
// first where widgets come from (Paperboard, then each panel), then that
// source's widgets as live previews. Pick a size, then drag a preview onto
// Home or press it to drop it in the first free spot. With one source
// there is nothing to choose, so its widgets are shown straight away.
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
    const sources = createMemo<Source[]>(() => [{ key: "paperboard", kind: "builtin" }, ...props.computers.flatMap(panelSources)]);
    const choosing = () => sources().length > 1 || props.computers.some((c) => props.panelsLoadFailed[c.id]);
    const open = createMemo<Source | null>(() => {
        if (!choosing()) return sources()[0];
        return sources().find((s) => s.key === openKey()) ?? null;
    });
    const openName = () => {
        const source = open();
        return source?.kind === "panel" ? source.panel.name : "Paperboard";
    };
    let root: HTMLElement | undefined;
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
        queueMicrotask(() => listTop?.querySelector<HTMLElement>(`[data-value="${CSS.escape(key ?? "")}"] input`)?.focus());
    };

    onMount(() => {
        if (!root) return;
        const el = root;
        const report = () => props.onWidth(el.offsetWidth + parseFloat(getComputedStyle(el).right));
        const resize = new ResizeObserver(report);
        resize.observe(el);
        report();
        onCleanup(() => resize.disconnect());
    });

    return (
        <aside ref={root} class={styles.library} aria-label="Widget gallery">
            <div class={styles.libraryHeader}>
                <Show when={choosing() && open()}>
                    <PaperButton ref={backButton} size="small" variant="text" icon onClick={closeSource} aria-label="Back to all widgets">
                        arrow_back
                    </PaperButton>
                </Show>
                <div class={styles.libraryTitle}>
                    <PaperText size={3} weight={700}>{choosing() && open() ? openName() : "Add widgets"}</PaperText>
                    <PaperText size={1} color="text-subtle">
                        {open() ? "Drag onto Home, or click to add" : "Choose where a widget comes from"}
                    </PaperText>
                </div>
                <PaperButton size="small" variant="primary" onClick={props.onDone}>Done</PaperButton>
            </div>
            <Show when={props.full}>
                <div class={styles.libraryNote}>
                    <PaperText size={1} color="text-subtle">Home is full. Remove a widget to add another.</PaperText>
                </div>
            </Show>

            <Show
                when={open()}
                fallback={
                    <div ref={listTop} class={styles.librarySources}>
                        {/* choosing a source opens it; none stays chosen once it is left */}
                        <PaperList
                            name="widget-source"
                            value={openKey() ?? ""}
                            onValueChange={(key) => openSource(String(key))}
                            fullWidth
                            borderless
                            scrollable="y"
                        >
                            <SourceRow
                                key="paperboard"
                                icon={<PaperIcon>widgets</PaperIcon>}
                                name="Paperboard"
                                detail={BUILTIN_WIDGETS.filter((w) => !w.unlisted).map((w) => w.declaration.name).join(", ")}
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
                                            <div class={styles.libraryNote} role="alert">
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
                                                    />
                                                );
                                            }}
                                        </For>
                                    </>
                                )}
                            </For>
                        </PaperList>
                    </div>
                }
            >
                {(source) => (
                    <div class={styles.libraryList}>
                        <Show when={source().kind === "builtin" && props.computers.length > 1}>
                            <div class={styles.chipRow} role="group" aria-label="CPU and Memory show">
                                <For each={props.computers}>
                                    {(computer) => (
                                        <PaperChip selected={builtinComputer() === computer.id} onClick={() => setChosenComputer(computer.id)}>
                                            {computer.name}
                                        </PaperChip>
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

const SourceRow: Component<{ key: string; icon: JSX.Element; name: string; detail: string }> = (props) => (
    <PaperListItem
        value={props.key}
        icon={props.icon}
        description={props.detail}
        actions={<PaperIcon>chevron_right</PaperIcon>}
    >
        {props.name}
    </PaperListItem>
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
    const widest = () => Math.max(...props.widget.sizes.map((s) => parseWidgetSize(s)?.w ?? 1));
    // what a panel widget's options offer comes from the panel's service, asked
    // when the card appears; a built-in's are its own. Until every option has
    // a value there is nothing to add
    const declared = () => props.widget.options ?? [];
    const [choices, setChoices] = createSignal<
        { kind: "loading" } | { kind: "ready"; lists: Record<string, WidgetChoice[]> } | { kind: "failed"; message: string }
    >({ kind: "loading" });
    const [chosen, setChosen] = createSignal<WidgetOptionValues>({});
    let request = 0;
    const loadChoices = async () => {
        const from = props.entryAt(size());
        if (declared().length === 0) return;
        const mine = ++request;
        setChoices({ kind: "loading" });
        try {
            const offered =
                from.source === "builtin"
                    ? declared().map((option) => builtinWidget(props.widget.id)?.choices?.[option.id] ?? [])
                    : await Promise.all(
                          declared().map((option) => getWidgetChoices(from.computerId, from.panelId, props.widget.id, option.id)),
                      );
            if (mine !== request) return;
            const lists: Record<string, WidgetChoice[]> = {};
            const next: WidgetOptionValues = {};
            declared().forEach((option, index) => {
                lists[option.id] = offered[index];
                // what was picked stays picked while it is still offered
                const kept = offered[index].find((choice) => choice.value === chosen()[option.id]) ?? offered[index][0];
                if (kept) next[option.id] = kept.value;
            });
            setChosen(next);
            setChoices({ kind: "ready", lists });
        } catch (err) {
            if (mine !== request) return;
            logToMain("warn", `Couldn't load choices for widget ${props.widget.id}:`, err);
            setChoices({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
        }
    };
    onMount(() => void loadChoices());
    onCleanup(() => { request++; });
    const listOf = (optionId: string) => {
        const state = choices();
        return state.kind === "ready" ? (state.lists[optionId] ?? []) : [];
    };
    /** the chosen values once every declared option has one; null until then */
    const options = createMemo<WidgetOptionValues | null>(() => {
        if (declared().length === 0) return {};
        const values = chosen();
        return choices().kind === "ready" && declared().every((option) => values[option.id]) ? values : null;
    });
    const unavailable = () => props.full || options() === null;
    const entry = (): LibraryEntry => {
        const at = props.entryAt(size());
        const values = options();
        return values && Object.keys(values).length > 0 ? { ...at, options: values } : at;
    };
    const previewCell = () => Math.min(PREVIEW_CELL, PREVIEW_WIDTH / widest());
    const scale = () => previewCell() / props.cell;
    const real = () => ({ w: parsed().w * props.cell - props.inset * 2, h: parsed().h * props.cell - props.inset * 2 });
    const previewId = `preview-${crypto.randomUUID()}`;
    const builtin = () => (entry().source === "builtin" ? builtinWidget(props.widget.id) : undefined);
    const computerName = () => props.computers.find((c) => c.id === entry().computerId)?.name ?? entry().computerId;

    return (
        <PaperCard role="group" aria-label={props.widget.name} surface="frontest" padding="full" gap="threefourths">
            <div>
                <PaperText size={2} weight={700} as="div">{props.widget.name}</PaperText>
                <Show when={props.widget.description}>
                    <PaperText size={1} color="text-subtle" as="div">{props.widget.description}</PaperText>
                </Show>
            </div>
            <div class={styles.previewStage}>
                {/* a patch of Home as big as the widget's largest size, so sizes compare */}
                <div
                    class={`${styles.previewPatch} ${styles.dots}`}
                    style={{
                        width: `${widest() * previewCell()}px`,
                        height: `${tallest() * previewCell()}px`,
                        "--home-cell": `${previewCell()}px`,
                    }}
                >
                <button
                    type="button"
                    class={styles.preview}
                    style={{ width: `${real().w * scale()}px`, height: `${real().h * scale()}px` }}
                    disabled={unavailable()}
                    aria-label={`Add ${props.widget.name}, ${sizeLabel(size())}`}
                    onPointerDown={(e) => {
                        if (e.button === 0 && !unavailable()) props.onStartDrag(entry(), e);
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
                                    // a frame is given its options once, so another choice is another frame
                                    <Show when={options() ? JSON.stringify(options()) : null} keyed>
                                        {(_chosen) => {
                                            const panelEntry = () => entry() as Extract<LibraryEntry, { source: "panel" }>;
                                            return (
                                            <PanelWidgetFrame
                                                computerId={panelEntry().computerId}
                                                computerName={props.frameFacts(panelEntry().computerId, panelEntry().panelId).computerName}
                                                panelId={panelEntry().panelId}
                                                widgetId={props.widget.id}
                                                instanceId={previewId}
                                                options={panelEntry().options}
                                                service={props.frameFacts(panelEntry().computerId, panelEntry().panelId).service}
                                                revision={props.frameFacts(panelEntry().computerId, panelEntry().panelId).revision}
                                                size={parsed()}
                                                visible={props.visible}
                                                label={`${props.widget.name} preview`}
                                                queue={props.queue}
                                            />
                                            );
                                        }}
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
                                        options={entry().options ?? {}}
                                        visible={props.visible}
                                        panelName={(panelId) => props.panelName(entry().computerId, panelId)}
                                        computers={props.computers}
                                        panels={props.panelsByComputer[entry().computerId]}
                                        panelsFailed={!!props.panelsLoadFailed[entry().computerId]}
                                        onRetryPanels={() => props.onRetry(entry().computerId)}
                                    />
                                )}
                            </Show>
                        </div>
                    </div>
                </button>
                </div>
            </div>
            <Show when={props.widget.sizes.length > 1}>
                <div class={styles.chipRow} role="group" aria-label={`${props.widget.name} size`}>
                    <For each={props.widget.sizes}>
                        {(option) => {
                            const shape = parseWidgetSize(option) ?? { w: 1, h: 1 };
                            return (
                                <PaperChip
                                    selected={size() === option}
                                    aria-label={sizeLabel(option)}
                                    onClick={() => setSize(option)}
                                    icon={
                                        <span
                                            class={styles.sizeGlyph}
                                            style={{
                                                width: `calc(var(--paper-uigap-half) * ${shape.w})`,
                                                height: `calc(var(--paper-uigap-half) * ${shape.h})`,
                                            }}
                                            aria-hidden="true"
                                        />
                                    }
                                >
                                    {sizeLabel(option)}
                                </PaperChip>
                            );
                        }}
                    </For>
                </div>
            </Show>
            <For each={declared()}>
                {(option) => (
                    <div class={styles.optionRow} role="group" aria-label={option.label}>
                        <PaperText size={1} color="text-subtle">{option.label}</PaperText>
                        <PaperSelectMenu
                            name={`${previewId}-${option.id}`}
                            fullWidth
                            value={chosen()[option.id]}
                            onValueChange={(value) => setChosen((previous) => ({ ...previous, [option.id]: String(value) }))}
                            disabled={listOf(option.id).length === 0}
                            placeholder={choices().kind === "loading" ? "Loading…" : "Nothing to choose yet"}
                        >
                            <For each={listOf(option.id)}>
                                {(choice) => <PaperSelectMenuItem value={choice.value}>{choice.label}</PaperSelectMenuItem>}
                            </For>
                        </PaperSelectMenu>
                    </div>
                )}
            </For>
            <Show when={declared().length > 0 && choices().kind !== "loading" && options() === null}>
                <div class={styles.optionNote} role={choices().kind === "failed" ? "alert" : "status"}>
                    <PaperText size={1} color="text-subtle">
                        {choices().kind === "failed"
                            ? `Couldn't load this widget's choices: ${(choices() as { message: string }).message}`
                            : `There is nothing to choose yet. Set this up in ${props.entryAt(size()).sourceName}, then check again.`}
                    </PaperText>
                    <PaperButton size="tiny" variant="text" onClick={() => void loadChoices()}>
                        {choices().kind === "failed" ? "Retry" : "Check again"}
                    </PaperButton>
                </div>
            </Show>
        </PaperCard>
    );
};

export default WidgetLibrary;
