import { PaperButton, PaperEmptyState, PaperModal, PaperPresence, PaperText } from "@mileniumhq/paperui";
import {
    type Component,
    createEffect,
    createMemo,
    createSignal,
    For,
    on,
    onCleanup,
    onMount,
    Show,
    untrack,
} from "solid-js";
import { parseWidgetSize, WIDGET_MAX_HEIGHT, type PanelItem, type WidgetOptionValues, type WidgetSize } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import {
    canPlace,
    canPlaceOnPhone,
    computeGeometry,
    findFreeSpot,
    findPhoneSpot,
    fitBesideGallery,
    fitCanvas,
    FLOOR_CELL,
    MAX_HOME_ITEMS,
    MAX_PHONE_PAGES,
    pageOf,
    PHONE_COLUMNS,
    phoneLayoutFrom,
    placementOf,
    sizeOf,
    stepPlacement,
    usedColumns,
    usedPages,
    usedRows,
    withoutEmptyPages,
    type HomeItem,
    type Placement,
} from "../../lib/homeLayout";
import { createLoadQueue } from "../../lib/loadQueue";
import WidgetTile from "./WidgetTile";
import WidgetLibrary, { sizeLabel, type LibraryEntry } from "./WidgetLibrary";
import PanelWidgetFrame, { type FrameFacts } from "./PanelWidgetFrame";
import { BuiltinView, builtinWidget, defaultHomeItems } from "./builtins";
import { createHomePersistence } from "./homePersistence";
import { createHomeFrames } from "./homeFrames";
import { createHomeDrag } from "./homeDrag";
import { tileStatus } from "./tileStatus";
import styles from "./Home.module.css";

// Loading more than this many frames at once stalled the shell's own
// frames in measurement; four was smooth and finished sooner.
const CONCURRENT_LOADS = 4;
// empty columns kept in view beside the widgets while the gallery is open
const GALLERY_SPARE_COLUMNS = 2;
// room between a page's cells and the screen's sides
const PHONE_GUTTER_PX = 12;

/** What a widget is drawn from: a placed item, or a gallery entry being dragged. */
type WidgetRef = Pick<LibraryEntry, "computerId" | "source"> & { widgetId: string; panelId?: string; options?: WidgetOptionValues };

export interface HomeViewProps {
    visible: boolean;
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    onRefreshPanels: (computerId: string) => void;
    onOpenPanel: (computerId: string, panelId: string) => void;
    onOpenComputer: (computerId: string) => void;
    /** bumped when a panel is restarted, by `computerId::panelId` */
    reloadTokens: Record<string, number>;
    /** the phone layout: pages of one column, its own arrangement. Fixed for Home's life. */
    mobile?: boolean;
}

const HomeView: Component<HomeViewProps> = (props) => {
    const phone = () => !!props.mobile;
    // the layout and its saves (homePersistence.ts)
    const layout = createHomePersistence(phone);
    const items = layout.items;
    const loadState = layout.loadState;
    const itemsById = createMemo(() => new Map(items().map((item) => [item.id, item])));
    const itemIds = createMemo(
        () => items().map((item) => item.id),
        [],
        { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
    );
    const [editing, setEditingNow] = createSignal(false);
    // the canvas eases only while it changes size for the gallery, so a
    // window resize still tracks the window exactly
    const [easing, setEasing] = createSignal(false);
    let easeTimer: ReturnType<typeof setTimeout> | undefined;
    const setEditing = (next: boolean) => {
        if (next === editing()) return;
        // for as long as the transition the stylesheet gives it, which is none under reduced motion
        const seconds = scroller ? parseFloat(getComputedStyle(scroller).getPropertyValue("--paper-mid-transition")) : 0;
        setEasing(true);
        clearTimeout(easeTimer);
        easeTimer = setTimeout(() => setEasing(false), (Number.isFinite(seconds) ? seconds : 0) * 1000);
        setEditingNow(next);
    };
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    // phones: the gallery's sheet; the page on screen; a tick per scroll,
    // for what moves with it
    const [sheetOpen, setSheetOpen] = createSignal(false);
    const [page, setPage] = createSignal(0);
    const [scrolled, setScrolled] = createSignal(0);
    const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
    const queue = createLoadQueue(CONCURRENT_LOADS);
    // each widget's frame lives while its tile is near the view (homeFrames.ts)
    const frames = createHomeFrames({ ids: itemIds, visible: () => props.visible, phone });

    const [galleryWidth, setGalleryWidth] = createSignal(0);
    let scroller: HTMLDivElement | undefined;
    let grid: HTMLDivElement | undefined;

    // ── dragging (homeDrag.ts) ───────────────────────────────────────────
    // made before the geometry it measures against, which grows a page for
    // a carried widget; what it is handed is read only once something is carried
    const carrying = createHomeDrag({
        phone,
        scroller: () => scroller,
        grid: () => grid,
        geometry: () => geometry(),
        phoneGeometry: () => phoneGeometry(),
        scale: () => scale(),
        scrolled,
        fits: (p, ignoreId) => fits(p, ignoreId),
        full: () => items().length >= MAX_HOME_ITEMS,
        page,
        pages: () => pages(),
        showPage: (index) => showPage(index),
        onAdd: (entry) => addToFirstFreeSpot(entry),
        onSelect: setSelectedId,
        onDropNew: (entry, p) => addAt(entry, p),
        onDropMove: (id, p) => void moveTo(id, p),
        onSheetDone: () => closeSheet(),
    });
    const dragging = () => !!carrying.drag()?.started;

    // ── geometry ─────────────────────────────────────────────────────────
    // the layout never changes to fit: when it is wider than the window, or
    // the gallery takes room from it, it is drawn smaller
    // A phone draws pages side by side, each the screen's width with
    // PHONE_COLUMNS cells inside it, as many rows as fit the screen. While a
    // widget is carried there is one more, empty page to carry it to.
    const phoneCell = createMemo(() => Math.max(FLOOR_CELL, (viewport().width - PHONE_GUTTER_PX * 2) / PHONE_COLUMNS));
    const phoneRows = createMemo(() => Math.max(WIDGET_MAX_HEIGHT, Math.floor(viewport().height / phoneCell())));
    const pages = createMemo(() => Math.min(MAX_PHONE_PAGES, usedPages(items()) + (dragging() ? 1 : 0)));
    const pageWidth = () => viewport().width;
    const phoneGeometry = () => ({ cell: phoneCell(), pageWidth: pageWidth(), gutter: PHONE_GUTTER_PX, pages: pages(), rows: phoneRows() });
    // a phone shows only paired computers, so it starts with the first one at
    // a glance and leaves out widgets of computers it doesn't show. Compared
    // as a string: a status update re-sends the same computers
    const shownIds = createMemo(() => props.computers.map((c) => c.id).join("\n"));
    const phoneDefaults = createMemo(() => {
        const first = shownIds().split("\n")[0];
        return first ? defaultHomeItems(first) : [];
    });
    // a phone Home never arranged follows the window's layout and the screen
    createEffect(on([layout.unarranged, phoneDefaults, phoneRows, shownIds], ([from, defaults, rows, shown]) => {
        if (!from) return;
        layout.show(phoneLayoutFrom(from === "default" ? defaults : from, rows, new Set(shown.split("\n"))));
    }));

    const geometry = createMemo(() =>
        phone() ? { cell: phoneCell(), across: pages() * PHONE_COLUMNS } : computeGeometry(viewport().width, items()),
    );
    const gridWidth = () => (phone() ? pages() * pageWidth() : geometry().across * geometry().cell);
    // a gallery left open on a hidden Home is released with Home's widgets
    const galleryOpen = () => editing() && loadState() === "ready" && !frames.suspended();
    // The gallery floats over Home's right edge. Home keeps its size while
    // its widgets, and a spare column pair to drop beside them, clear it.
    const keptWidth = () => Math.min(geometry().across, usedColumns(items()) + GALLERY_SPARE_COLUMNS) * geometry().cell;
    const fitted = createMemo(() =>
        phone()
            ? { scale: 1, left: 0, width: gridWidth() }
            : galleryOpen()
              ? fitBesideGallery(gridWidth(), keptWidth(), viewport().width, viewport().width - galleryWidth())
              : fitCanvas(gridWidth(), viewport().width),
    );
    // columns not under the gallery, where an added widget can be seen landing
    const visibleAcross = () =>
        galleryOpen() && !phone()
            ? Math.max(1, Math.floor((viewport().width - galleryWidth() - gridLeft()) / (geometry().cell * scale())))
            : geometry().across;
    const scale = () => fitted().scale;
    const gridLeft = () => fitted().left;
    // a spare row to drop into while editing; never fewer than reach the
    // bottom of the window, so the dots do too
    const rows = createMemo(() =>
        phone()
            ? Math.max(phoneRows(), usedRows(items(), 0))
            : Math.max(usedRows(items(), editing() ? 1 : 0), Math.floor(viewport().height / (geometry().cell * scale()))),
    );
    const gridHeight = () => rows() * geometry().cell;
    const inset = () => Math.round(geometry().cell * 0.06);
    const fits = (p: Placement, ignoreId?: string) =>
        phone() ? canPlaceOnPhone(items(), p, phoneRows(), ignoreId) : canPlace(items(), p, ignoreId);

    const rectOf = (p: Placement) => {
        const g = geometry();
        // on a phone, x counts across pages: which page, then which column in it
        const left = phone()
            ? pageOf(p) * pageWidth() + PHONE_GUTTER_PX + (p.x % PHONE_COLUMNS) * g.cell
            : p.x * g.cell;
        return {
            left: left + inset(),
            top: p.y * g.cell + inset(),
            width: p.w * g.cell - inset() * 2,
            height: p.h * g.cell - inset() * 2,
        };
    };
    const px = (r: { left: number; top: number; width: number; height: number }) => ({
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
    });

    // ── what each placed widget can show ─────────────────────────────────
    const statusOf = (item: HomeItem) =>
        tileStatus(item, {
            computers: props.computers,
            panelsByComputer: props.panelsByComputer,
            panelsLoadFailed: props.panelsLoadFailed,
            refreshPanels: props.onRefreshPanels,
        });
    const computerName = (id: string) => props.computers.find((c) => c.id === id)?.name ?? id;
    const panelName = (computerId: string, panelId: string) =>
        props.panelsByComputer[computerId]?.find((p) => p.id === panelId)?.name ?? panelId;
    // what a panel's widget frames load against: whether it runs a service,
    // and a revision that changes when it is updated or restarted
    const frameFacts = (computerId: string, panelId: string): FrameFacts => {
        const panel = props.panelsByComputer[computerId]?.find((p) => p.id === panelId);
        return {
            service: !!panel?.service,
            computerName: computerName(computerId),
            revision: `${panel?.version ?? ""}|${panel?.updatedAt ?? ""}|${props.reloadTokens[`${computerId}::${panelId}`] ?? 0}`,
        };
    };
    const declarationOf = (item: HomeItem) =>
        item.source === "builtin"
            ? builtinWidget(item.widgetId)?.declaration
            : props.panelsByComputer[item.computerId]?.find((p) => p.id === item.panelId)?.widgets?.find((w) => w.id === item.widgetId);
    const labelOf = (item: HomeItem) => {
        const name = declarationOf(item)?.name ?? item.widgetId;
        if (item.source === "panel") return `${name} (${panelName(item.computerId, item.panelId)})`;
        // a CPU or Memory widget says which computer it shows once there's a choice
        return builtinWidget(item.widgetId)?.perComputer && props.computers.length > 1 ? `${name} (${computerName(item.computerId)})` : name;
    };

    // ── panel lists for every computer ───────────────────────────────────
    // Home spans every paired computer, so it asks each one for its panels
    // once; a failure is shown with a retry on the tile and in the library.
    const requested = new Set<string>();
    // tracks the computers only: the lists it asks for land in panelsByComputer
    createEffect(on(shownIds, () => {
        const ids = new Set(props.computers.map((c) => c.id));
        for (const id of [...requested]) if (!ids.has(id)) requested.delete(id);
        for (const id of ids) {
            if (requested.has(id) || props.panelsByComputer[id]) continue;
            requested.add(id);
            props.onRefreshPanels(id);
        }
    }));

    onMount(() => {
        void layout.load();
        if (!scroller) return;
        const resize = new ResizeObserver(() => {
            // a hidden Home measures 0; keep the last real size
            if (!scroller || scroller.clientWidth === 0) return;
            const style = getComputedStyle(scroller);
            setViewport({
                width: scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                height: scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
            });
        });
        resize.observe(scroller);
        frames.attach(scroller);
        onCleanup(() => resize.disconnect());
    });

    // ── editing ──────────────────────────────────────────────────────────
    const addAt = (entry: LibraryEntry, p: Placement) => {
        if (items().length >= MAX_HOME_ITEMS || !fits(p)) return;
        const id = crypto.randomUUID();
        const base = {
            id,
            computerId: entry.computerId,
            widgetId: entry.widget.id,
            size: `${p.w}x${p.h}`,
            x: p.x,
            y: p.y,
            ...(entry.options && Object.keys(entry.options).length > 0 ? { options: entry.options } : {}),
        };
        layout.commit([...items(), entry.source === "builtin" ? { ...base, source: "builtin" } : { ...base, source: "panel", panelId: entry.panelId }]);
        setSelectedId(id);
    };
    const addToFirstFreeSpot = (entry: LibraryEntry) => {
        const size = parseWidgetSize(entry.size);
        if (!size) return;
        // a phone fills the page on screen first
        const spot = phone() ? findPhoneSpot(items(), size, phoneRows(), page()) : findFreeSpot(items(), size, Math.min(geometry().across, visibleAcross()));
        if (!spot) return;
        addAt(entry, spot);
        if (phone()) queueMicrotask(() => showPage(pageOf(spot)));
    };
    const moveTo = (id: string, p: Placement) => {
        if (!fits(p, id)) return false;
        layout.commit(items().map((item) => (item.id === id ? { ...item, x: p.x, y: p.y } : item)));
        return true;
    };
    const remove = (id: string) => {
        layout.commit(items().filter((item) => item.id !== id));
        if (selectedId() === id) setSelectedId(null);
    };

    // ── phones: the sheet and pages ──────────────────────────────────────
    // Edit Home raises the gallery as a sheet; a widget held in it is
    // carried out of it onto Home (homeDrag.ts).
    let addButton: HTMLButtonElement | undefined;
    const closeSheet = () => {
        if (!sheetOpen()) return;
        setSheetOpen(false);
        queueMicrotask(() => addButton?.focus());
    };
    // a carried widget must not scroll the gallery it came from: only a
    // non-passive listener on the touched element can stop that
    const holdSheetScroll = (el: HTMLElement) => {
        el.addEventListener("touchmove", (e) => { if (carrying.drag()) e.preventDefault(); }, { passive: false });
    };
    const onScroll = () => {
        setScrolled((n) => n + 1);
        if (phone() && scroller && pageWidth() > 0) setPage(Math.min(pages() - 1, Math.round(scroller.scrollLeft / pageWidth())));
    };
    const showPage = (index: number) => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        scroller?.scrollTo({ left: index * pageWidth(), behavior: reduce ? "auto" : "smooth" });
    };

    const startLibraryDrag = (entry: LibraryEntry, event: PointerEvent) => {
        const size = parseWidgetSize(entry.size);
        if (!size) return;
        // the ghost hangs from the pointer near its top, like picking up a card
        carrying.beginDrag(event, { kind: "new", entry }, entry.widget.name, size, { x: size.w / 2, y: 0.3 });
    };
    const startTileDrag = (item: HomeItem, event: PointerEvent) => {
        const el = frames.element(item.id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cell = geometry().cell;
        carrying.beginDrag(event, { kind: "move", itemId: item.id }, labelOf(item), sizeOf(item), {
            x: ((event.clientX - rect.left) / scale() + inset()) / cell,
            y: ((event.clientY - rect.top) / scale() + inset()) / cell,
        });
    };

    // the gallery's Done button: where focus goes when editing starts, so the
    // keyboard is in the gallery instead of on the page's body
    let doneButton: HTMLButtonElement | undefined;
    const startEditing = () => {
        setEditing(true);
        // a phone's sheet is a dialog, which takes focus itself
        if (phone()) setSheetOpen(true);
        else queueMicrotask(() => doneButton?.focus());
    };

    const onTileKey = (item: HomeItem, event: KeyboardEvent) => {
        const steps: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
        };
        const step = steps[event.key];
        if (step) {
            event.preventDefault();
            moveTo(item.id, stepPlacement(placementOf(item), step[0], step[1]));
        } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            const index = items().findIndex((i) => i.id === item.id);
            remove(item.id);
            // keep keyboard focus on Home instead of dropping it to the body
            const next = items()[Math.min(index, items().length - 1)];
            queueMicrotask(() => (next ? frames.element(next.id)?.querySelector<HTMLElement>("[tabindex]") : editButton)?.focus());
        }
    };

    let editButton: HTMLButtonElement | undefined;
    let emptyAddButton: HTMLButtonElement | undefined;
    const finishEditing = () => {
        carrying.stop();
        setSheetOpen(false);
        // a page emptied while arranging closes up
        if (phone()) {
            const tidy = withoutEmptyPages(items());
            if (tidy !== items()) layout.commit(tidy);
        }
        setEditing(false);
        setSelectedId(null);
        // the Done button is gone; focus lands on the button that comes back:
        // Edit Home, or Add widgets on a Home left empty
        queueMicrotask(() => [editButton, emptyAddButton].find((button) => button?.isConnected)?.focus());
    };

    // Escape leaves editing, once whatever is open over Home (a dialog, a
    // menu, a list of choices, a carried widget) has had it
    createEffect(on([editing, () => props.visible], ([isEditing, visible]) => {
        if (!isEditing || !visible) return;
        const leave = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || carrying.drag()) return;
            const open = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]');
            // a closed menu stays mounted, hidden
            if (Array.from(open).some((el) => el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0)) return;
            event.preventDefault();
            finishEditing();
        };
        // capture: what is open is seen before Escape closes it
        window.addEventListener("keydown", leave, true);
        onCleanup(() => window.removeEventListener("keydown", leave, true));
    }));

    onCleanup(() => clearTimeout(easeTimer));

    // what the ghost draws; the same widget stays the same object while the
    // pointer moves, so the ghost's content isn't rebuilt on every move
    const ghostFrom = createMemo<WidgetRef | undefined>(
        () => {
            const d = carrying.drag();
            if (!d?.started) return undefined;
            if (d.source.kind === "new") return { ...d.source.entry, widgetId: d.source.entry.widget.id };
            return itemsById().get(d.source.itemId);
        },
        undefined,
        {
            equals: (a, b) =>
                a?.source === b?.source &&
                a?.computerId === b?.computerId &&
                a?.widgetId === b?.widgetId &&
                a?.panelId === b?.panelId &&
                JSON.stringify(a?.options) === JSON.stringify(b?.options),
        },
    );
    const ghost = () => {
        const d = carrying.drag();
        if (!d?.started) return null;
        const g = geometry();
        return {
            name: d.name,
            size: d.size,
            // laid out at its real size and drawn at the canvas's, like the tiles
            style: {
                left: `${d.pointer.x - (d.grab.x * g.cell - inset()) * scale()}px`,
                top: `${d.pointer.y - (d.grab.y * g.cell - inset()) * scale()}px`,
                width: `${d.size.w * g.cell - inset() * 2}px`,
                height: `${d.size.h * g.cell - inset() * 2}px`,
                transform: `scale(${scale()})`,
            },
        };
    };
    // a widget being arranged doesn't navigate when pressed
    const navigates = () => !editing();
    // a built-in widget draws in place; a panel widget is the panel's frame
    const content = (from: WidgetRef, size: () => WidgetSize, visible: () => boolean, instanceId: string, label: () => string) => {
        const builtin = from.source === "builtin" ? builtinWidget(from.widgetId) : undefined;
        if (builtin) {
            return (
                <BuiltinView
                    widget={builtin}
                    computerId={from.computerId}
                    computerName={computerName(from.computerId)}
                    showComputer={props.computers.length > 1}
                    size={size()}
                    options={from.options ?? {}}
                    visible={visible()}
                    panelName={(panelId) => panelName(from.computerId, panelId)}
                    computers={props.computers}
                    panels={props.panelsByComputer[from.computerId]}
                    panelsFailed={!!props.panelsLoadFailed[from.computerId]}
                    onRetryPanels={() => props.onRefreshPanels(from.computerId)}
                    onOpenPanel={navigates() ? (panelId) => props.onOpenPanel(from.computerId, panelId) : undefined}
                    onOpenComputer={navigates() ? props.onOpenComputer : undefined}
                />
            );
        }
        if (!from.panelId) return null;
        const panelId = from.panelId;
        return (
            <PanelWidgetFrame
                computerId={from.computerId}
                computerName={frameFacts(from.computerId, panelId).computerName}
                panelId={panelId}
                widgetId={from.widgetId}
                instanceId={instanceId}
                size={size()}
                options={from.options}
                service={frameFacts(from.computerId, panelId).service}
                revision={frameFacts(from.computerId, panelId).revision}
                visible={visible()}
                label={label()}
                queue={queue}
                onOpenPanel={() => props.onOpenPanel(from.computerId, panelId)}
            />
        );
    };

    return (
        <div class={styles.home} classList={{ [styles.phone]: phone(), [styles.away]: !props.visible }}>
            <div class={styles.canvasArea}>
                <div
                    ref={scroller}
                    class={styles.scroller}
                    classList={{ [styles.editing]: editing(), [styles.dragging]: dragging() }}
                    // arranging Home: a sideways swipe turns pages, it doesn't leave Home
                    data-paper-no-swipe-back={editing() ? "" : undefined}
                    onScroll={onScroll}
                >
                    <div class={styles.stage} style={{ height: `${gridHeight() * scale()}px`, width: `${fitted().width}px` }}>
                    <div
                        ref={grid}
                        class={styles.grid}
                        classList={{ [styles.easing]: easing(), [styles.dots]: !phone() && editing() }}
                        style={{
                            width: `${gridWidth()}px`,
                            height: `${gridHeight()}px`,
                            transform: phone() ? "none" : `translateX(${gridLeft()}px) scale(${scale()})`,
                            "--home-cell": `${geometry().cell}px`,
                        }}
                    >
                        {/* a phone's pages: where the swipe stops, and their dots while arranging */}
                        <Show when={phone()}>
                            <For each={Array.from({ length: pages() }, (_, i) => i)}>
                                {(index) => (
                                    <div class={styles.page} style={{ left: `${index * pageWidth()}px`, width: `${pageWidth()}px` }}>
                                        <Show when={editing()}>
                                            <div
                                                class={`${styles.pageDots} ${styles.dots}`}
                                                style={{ left: `${PHONE_GUTTER_PX}px`, width: `${PHONE_COLUMNS * geometry().cell}px`, height: `${phoneRows() * geometry().cell}px` }}
                                            />
                                        </Show>
                                    </div>
                                )}
                            </For>
                        </Show>
                        <Show when={loadState() === "ready"}>
                            <For each={itemIds()}>
                                {(id) => {
                                    // keyed by instance id: a moved or resized widget keeps
                                    // its frame and focus instead of remounting
                                    let last: HomeItem | undefined;
                                    const item = () => (last = itemsById().get(id) ?? last) as HomeItem;
                                    const status = () => statusOf(item());
                                    // a move is not a resize: the widget hears only real size changes
                                    // memos, so the frame's event handlers read plain values
                                    const live = createMemo(() => frames.live(id));
                                    const visible = createMemo(() => props.visible && frames.inView(id));
                                    const size = createMemo(() => sizeOf(item()), undefined, {
                                        equals: (a, b) => a.w === b.w && a.h === b.h,
                                    });
                                    return (
                                        <WidgetTile
                                            ref={(el) => frames.observe(id, el)}
                                            instanceId={id}
                                            status={status()}
                                            live={live()}
                                            editing={editing()}
                                            selected={selectedId() === id}
                                            lifted={carrying.lifted(id)}
                                            style={px(rectOf(placementOf(item())))}
                                            label={labelOf(item())}
                                            sizeLabel={sizeLabel(item().size)}
                                            oneCell={sizeOf(item()).w === 1}
                                            onRemove={() => remove(id)}
                                            onPointerDown={(e) => startTileDrag(item(), e)}
                                            onKeyDown={(e) => onTileKey(item(), e)}
                                            onFocus={() => setSelectedId(id)}
                                        >
                                            {/* an item never changes what it shows, only where and how big */}
                                            {untrack(() => content(item(), size, visible, id, () => labelOf(item())))}
                                        </WidgetTile>
                                    );
                                }}
                            </For>
                        </Show>
                        <Show when={carrying.target()}>
                            {(t) => (
                                <div
                                    class={styles.dropOutline}
                                    classList={{ [styles.dropInvalid]: !t().valid }}
                                    style={px(rectOf(t().placement))}
                                    aria-hidden="true"
                                />
                            )}
                        </Show>
                    </div>
                    </div>
                </div>

                <Show when={loadState() === "ready" && items().length === 0 && !editing()}>
                    <div class={styles.centerState}>
                        <PaperEmptyState
                            icon="widgets"
                            title="Welcome home"
                            description="Widgets from your panels, on every computer, in one place."
                        >
                            <PaperButton ref={emptyAddButton} variant="primary" onClick={startEditing}>Add widgets</PaperButton>
                        </PaperEmptyState>
                    </div>
                </Show>
                <Show when={loadState() === "loading"}>
                    <div class={styles.centerState} role="status">
                        <PaperEmptyState description="Loading Home…" />
                    </div>
                </Show>
                <Show when={typeof loadState() === "object" ? (loadState() as { error: string }) : null}>
                    {(failed) => (
                        <div class={styles.centerState} role="alert">
                            <PaperEmptyState icon="error" title="Couldn't load Home" description={failed().error}>
                                <PaperButton variant="primary" onClick={() => void layout.load()}>Retry</PaperButton>
                                <PaperButton variant="danger" onClick={() => void layout.startOver()}>Start over with an empty Home</PaperButton>
                            </PaperEmptyState>
                        </div>
                    )}
                </Show>

                <Show when={loadState() === "ready" && !editing() && items().length > 0}>
                    <div class={styles.toolbar}>
                        <PaperButton ref={editButton} size="small" onClick={startEditing}>Edit Home</PaperButton>
                    </div>
                </Show>
                {/* a phone's gallery is a sheet, so arranging needs its own way back to it and out */}
                <Show when={phone() && galleryOpen()}>
                    <div class={styles.toolbar}>
                        <PaperButton ref={addButton} size="small" onClick={() => setSheetOpen(true)}>Add widgets</PaperButton>
                        <PaperButton size="small" variant="primary" onClick={finishEditing}>Done</PaperButton>
                    </div>
                </Show>
                <Show when={phone() && pages() > 1}>
                    <div class={styles.pageIndicator} role="group" aria-label="Pages">
                        <For each={Array.from({ length: pages() }, (_, i) => i)}>
                            {(index) => (
                                <button
                                    type="button"
                                    class={styles.pageDot}
                                    aria-label={`Page ${index + 1} of ${pages()}`}
                                    aria-current={page() === index ? "page" : undefined}
                                    onClick={() => showPage(index)}
                                />
                            )}
                        </For>
                    </div>
                </Show>
                <Show when={layout.saveError()}>
                    <div class={styles.banner} role="alert">
                        <PaperText preset="error">Couldn't save Home: {layout.saveError()}</PaperText>
                        <PaperButton size="tiny" variant="text" onClick={layout.retrySave}>Retry</PaperButton>
                    </div>
                </Show>
            </div>

            <PaperModal
                open={phone() && sheetOpen() && galleryOpen()}
                concealed={carrying.sheetConcealed()}
                onClose={closeSheet}
                placement="bottom"
                size="full"
                noHeader
                noPadding
                aria-label="Add widgets"
            >
                {/* the phone's gallery; a desktop's slides in beside Home */}
                <Show when={phone()}>
                    <div ref={holdSheetScroll} class={styles.sheetBody}>
                        <WidgetLibrary
                            sheet
                            computers={props.computers}
                            panelsByComputer={props.panelsByComputer}
                            panelsLoadFailed={props.panelsLoadFailed}
                            full={items().length >= MAX_HOME_ITEMS}
                            visible={props.visible}
                            cell={geometry().cell}
                            inset={inset()}
                            queue={queue}
                            panelName={panelName}
                            frameFacts={frameFacts}
                            onRetry={props.onRefreshPanels}
                            onStartDrag={carrying.holdLibraryEntry}
                            onAdd={(entry) => {
                                addToFirstFreeSpot(entry);
                                closeSheet();
                            }}
                            onDone={closeSheet}
                        />
                    </div>
                </Show>
            </PaperModal>
            <PaperPresence when={galleryOpen() && !phone()} motion="slide-end">
                <WidgetLibrary
                    onWidth={setGalleryWidth}
                    computers={props.computers}
                    panelsByComputer={props.panelsByComputer}
                    panelsLoadFailed={props.panelsLoadFailed}
                    full={items().length >= MAX_HOME_ITEMS}
                    visible={props.visible}
                    cell={geometry().cell}
                    inset={inset()}
                    queue={queue}
                    panelName={panelName}
                    frameFacts={frameFacts}
                    onRetry={props.onRefreshPanels}
                    onStartDrag={startLibraryDrag}
                    onAdd={addToFirstFreeSpot}
                    onDone={finishEditing}
                    doneRef={(el) => (doneButton = el)}
                />
            </PaperPresence>

            <Show when={ghost()}>
                {(g) => (
                    <div class={styles.ghost} style={g().style} aria-hidden="true">
                        {/* a built-in widget is picked up as itself; a panel's frame can't be, so its name stands in */}
                        <Show
                            when={ghostFrom()?.source === "builtin" ? ghostFrom() : undefined}
                            keyed
                            fallback={<PaperText preset="label">{g().name}</PaperText>}
                        >
                            {(from) => content(from, () => g().size, () => true, "ghost", () => g().name)}
                        </Show>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default HomeView;
