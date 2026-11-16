import { haptic, PaperButton, PaperEmptyState, PaperError, PaperFlex, PaperModal, PaperPresence, PaperText, showToast, sameData } from "@mileniumhq/paperui";
import {
    batch,
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
import { parseWidgetSize, type PanelItem } from "@mileniumhq/paperapi";
import type { ComputerInfo } from "../../lib/shell";
import {
    findFreeSpot,
    findPhoneSpot,
    MAX_HOME_ITEMS,
    pageOf,
    PHONE_COLUMNS,
    phoneLayoutFrom,
    placementOf,
    sizeOf,
    stepPlacement,
    withoutEmptyPages,
    type HomeItem,
    type Placement,
} from "../../lib/homeLayout";
import { createLoadQueue } from "../../lib/loadQueue";
import WidgetTile from "./WidgetTile";
import WidgetLibrary, { sizeLabel, type LibraryEntry } from "./WidgetLibrary";
import { defaultHomeItems } from "./builtins";
import { createHomePersistence } from "./homePersistence";
import { createHomeFrames } from "./homeFrames";
import { createHomeDrag } from "./homeDrag";
import { createHomeGeometry, px } from "./homeGeometry";
import { createPhonePages } from "./homePages";
import { createHomeWidgets, type WidgetRef } from "./homeWidgets";
import styles from "./Home.module.css";

// Loading more than this many frames at once stalled the shell's own
// frames in measurement; four was smooth and finished sooner.
const CONCURRENT_LOADS = 4;
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
        { equals: sameData },
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
    // the room inside Home's scroller, less its padding
    const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
    // room between a phone page's cells and the screen's sides: PaperUI's gap
    const [gutter, setGutter] = createSignal(0);
    const queue = createLoadQueue(CONCURRENT_LOADS);
    // each widget's frame lives while its tile is near the view (homeFrames.ts)
    const frames = createHomeFrames({ ids: itemIds, visible: () => props.visible, phone });

    const [galleryWidth, setGalleryWidth] = createSignal(0);
    let scroller: HTMLDivElement | undefined;
    let grid: HTMLDivElement | undefined;

    // ── phones: the sheet and pages (homePages.ts) ───────────────────────
    const phonePages = createPhonePages({
        phone,
        scroller: () => scroller,
        pageWidth: () => pageWidth(),
        pages: () => pages(),
        carrying: () => !!carrying.drag(),
    });
    const { sheetOpen, closeSheet, page, showPage } = phonePages;

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
        scrolled: phonePages.scrolled,
        fits: (p, ignoreId) => fits(p, ignoreId),
        full: () => items().length >= MAX_HOME_ITEMS,
        page,
        pages: () => pages(),
        showPage,
        onAdd: (entry) => addToFirstFreeSpot(entry),
        onSelect: setSelectedId,
        onDropNew: (entry, p) => addAt(entry, p),
        onDropMove: (id, p) => void moveTo(id, p),
        onSheetDone: closeSheet,
    });
    const dragging = () => !!carrying.drag()?.started;

    // ── geometry (homeGeometry.ts) ───────────────────────────────────────
    // a gallery left open on a hidden Home is released with Home's widgets
    const galleryOpen = () => editing() && loadState() === "ready" && !frames.suspended();
    const {
        phoneRows,
        pages,
        pageWidth,
        phoneGeometry,
        geometry,
        gridWidth,
        fitted,
        scale,
        gridLeft,
        visibleAcross,
        gridHeight,
        inset,
        fits,
        rectOf,
    } = createHomeGeometry({ phone, items, viewport, gutter, editing, dragging, galleryOpen, galleryWidth });
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

    // ── what each widget shows (homeWidgets.ts) ──────────────────────────
    const { statusOf, panelName, frameFacts, labelOf, content } = createHomeWidgets({
        computers: () => props.computers,
        panelsByComputer: () => props.panelsByComputer,
        panelsLoadFailed: () => props.panelsLoadFailed,
        refreshPanels: (computerId) => props.onRefreshPanels(computerId),
        openPanel: (computerId, panelId) => props.onOpenPanel(computerId, panelId),
        openComputer: (computerId) => props.onOpenComputer(computerId),
        reloadTokens: () => props.reloadTokens,
        queue,
        // a widget being arranged doesn't navigate when pressed
        navigates: () => !editing(),
    });

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
            const gap = parseFloat(style.getPropertyValue("--paper-uigap"));
            if (!Number.isFinite(gap)) throw new Error("Home can't lay out a phone's pages: PaperUI's --paper-uigap isn't set");
            batch(() => {
                setGutter(gap);
                setViewport({
                    width: scroller!.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                    height: scroller!.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
                });
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
    /** true once it is on Home; when nothing of its size fits, a toast says so */
    const addToFirstFreeSpot = (entry: LibraryEntry): boolean => {
        const size = parseWidgetSize(entry.size);
        if (!size) throw new Error(`The widget size "${entry.size}" is not WxH`);
        // a phone fills the page on screen first
        const spot = phone() ? findPhoneSpot(items(), size, phoneRows(), page()) : findFreeSpot(items(), size, Math.min(geometry().across, visibleAcross()));
        if (!spot) {
            const smaller = entry.widget.sizes.some((s) => {
                const other = parseWidgetSize(s);
                return other !== null && other.w * other.h < size.w * size.h;
            });
            haptic("warning");
            showToast({
                variant: "warning",
                title: `No room for ${entry.widget.name} at ${sizeLabel(entry.size)}`,
                message: `${phone() ? "Every page is full. Remove a widget" : "Remove or move a widget"}${smaller ? ", or pick a smaller size" : ""}.`,
            });
            return false;
        }
        addAt(entry, spot);
        if (phone()) queueMicrotask(() => showPage(pageOf(spot)));
        return true;
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

    const startLibraryDrag = (entry: LibraryEntry, event: PointerEvent) => {
        const size = parseWidgetSize(entry.size);
        if (!size) throw new Error(`The widget size "${entry.size}" is not WxH`);
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
        if (phone()) phonePages.openSheet();
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
        phonePages.dropSheet();
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
                sameData(a?.options, b?.options),
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
    return (
        <div class={styles.home} classList={{ [styles.phone]: phone(), [styles.away]: !props.visible }}>
            <div class={styles.canvasArea}>
                <div
                    ref={scroller}
                    class={styles.scroller}
                    classList={{ [styles.editing]: editing(), [styles.dragging]: dragging() }}
                    // arranging Home: a sideways swipe turns pages, it doesn't leave Home
                    data-paper-no-swipe-back={editing() ? "" : undefined}
                    onScroll={phonePages.onScroll}
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
                                                style={{ left: `${gutter()}px`, width: `${PHONE_COLUMNS * geometry().cell}px`, height: `${phoneRows() * geometry().cell}px` }}
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
                                    const size = createMemo(() => sizeOf(item()), undefined, { equals: sameData });
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
                        <div class={styles.centerState}>
                            <PaperFlex direction="column" align="center" gap="half">
                                <PaperError
                                    fill
                                    title="Couldn't load Home"
                                    error={failed().error}
                                    action={{ label: "Try again", onClick: () => void layout.load() }}
                                />
                                <PaperButton variant="danger" onClick={() => void layout.startOver()}>Start over with an empty Home</PaperButton>
                            </PaperFlex>
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
                        <PaperButton ref={phonePages.addButtonRef} size="small" onClick={phonePages.openSheet}>Add widgets</PaperButton>
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
                    {(why) => (
                        <div class={styles.banner}>
                            <PaperError
                                alert
                                title="Couldn't save Home"
                                error={`Changes to Home aren't saved: ${why()}`}
                                action={{ label: "Try again", onClick: () => layout.retrySave() }}
                            />
                        </div>
                    )}
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
                    <div ref={phonePages.holdSheetScroll} class={styles.sheetBody}>
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
                                if (addToFirstFreeSpot(entry)) closeSheet();
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
