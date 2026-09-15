import {
    createSignal,
    createMemo,
    createEffect,
    onMount,
    onCleanup,
    For,
    Show,
} from "solid-js";
import {
    PaperRail,
    PaperRailItem,
    PaperSeparator,
    PaperBadge,
    PaperFlex,
    PaperText,
    PaperInput,
    PaperButton,
    PaperIcon,
} from "@paperboard-dev/paperui";
import {
    actions as actionsApi,
    panels as panelsApi,
    type ActionInfo,
    type TriggerInfo,
    type PanelItem,
    type ActionSchema,
    type TriggerSchema,} from "@paperboard-dev/paperapi";
import { createStore } from "solid-js/store";
import ActionBlock from "./ActionBlock";
import { BUILTIN_CATEGORIES, type BuiltinCategory } from "../lib/builtins";
import {
    type FunctionDef,
    type FunctionParam,
    FUNCTION_PARAM_TYPES,
    buildCallSchema,
    buildTriggerSchema,
    createFunctionId,
} from "../lib/functions";
import { PaperModal, PaperSelectMenu, PaperSelectMenuItem } from "@paperboard-dev/paperui";
import { ACTIONS_PANEL_ID } from "../panelId";
import {
    buildLibrarySections,
    type LibrarySection,
} from "../lib/librarySections";

export interface ActionLibraryProps {
    onStartDrag: (
        item: ActionInfo | TriggerInfo,
        isTrigger: boolean,
        pos: { x: number; y: number },
        grabOffset: { x: number; y: number },
        iconSrc?: string,
    ) => void;
    functions?: FunctionDef[];
    onCreateFunction?: (name: string, params: FunctionParam[]) => void;
    onRenameFunction?: (fid: string, name: string) => void;
    onDeleteFunction?: (fid: string) => void;
}

export interface PanelCategory {
    id: string;
    domain: "panel";
    name: string;
    icon: string;
    iconUrl?: string;
    triggers: TriggerInfo[];
    actions: ActionInfo[];
    sections: LibrarySection[];
}

export type Category = BuiltinCategory | PanelCategory;

export default function ActionLibrary(props: ActionLibraryProps) {
    const [selectedCategoryId, setSelectedCategoryId] = createSignal<string>("logic.timing");
    const [search, setSearch] = createSignal("");
    const [installedPanels, setInstalledPanels] = createSignal<PanelItem[]>([]);
    const [registeredActions, setRegisteredActions] = createSignal<ActionInfo[]>([]);
    const [registeredTriggers, setRegisteredTriggers] = createSignal<TriggerInfo[]>([]);
    const [isCollapsed, setIsCollapsed] = createSignal(false);

    const [createOpen, setCreateOpen] = createSignal(false);
    const [editingId, setEditingId] = createSignal<string | null>(null);
    const [draftName, setDraftName] = createSignal("");
    // store keeps row identity stable while typing
    const [draftParams, setDraftParams] = createStore<FunctionParam[]>([]);

    const openCreateModal = () => {
        setEditingId(null);
        setDraftName("");
        setDraftParams([]);
        setCreateOpen(true);
    };

    const openRenameModal = (fn: FunctionDef) => {
        setEditingId(fn.id);
        setDraftName(fn.name);
        setDraftParams([]);
        setCreateOpen(true);
    };

    const draftValid = () => {
        if (!draftName().trim()) return false;
        if (editingId()) return true;
        const names = draftParams.map((p) => p.name.trim().toLowerCase());
        if (names.some((n) => !n)) return false;
        return new Set(names).size === names.length;
    };

    const handleConfirmCreate = () => {
        if (!draftValid()) return;
        const eid = editingId();
        if (eid) {
            props.onRenameFunction?.(eid, draftName().trim().replace(/[{}:]/g, ""));
        } else {
            props.onCreateFunction?.(
                draftName().trim(),
                draftParams.map((p) => ({
                    name: p.name.trim().replace(/[{}:]/g, ""),
                    type: p.type,
                })),
            );
        }
        setCreateOpen(false);
    };

    const loadLibrary = async () => {
        try {
            const panelsList = await panelsApi.list().catch(() => []);
            setInstalledPanels(panelsList);

            const acts = await actionsApi.list().catch(() => []);
            setRegisteredActions(acts);

            const trigs = await actionsApi.listTriggers().catch(() => []);
            setRegisteredTriggers(trigs);
        } catch (err) {
            console.error("[ActionLibrary] Failed to load library:", err);
        }
    };

    onMount(() => {
        loadLibrary();
        const unsub = (actionsApi as any).onRegistryChange?.(() => {
            loadLibrary();
        });
        onCleanup(() => {
            unsub?.();
        });
    });

    const getPanelIcon = (panelId: string): string => {
        const found = installedPanels().find((p) => p.id === panelId);
        if (found?.iconUrl) return found.iconUrl;
        if (found?.icon) {
            return `panel://local.${found.id}/${found.icon.replace(/^\.\//, "")}`;
        }
        return `panel://local.${panelId}/branding/icon.png`;
    };

    const getPanelInfo = (panelId: string) => {
        const found = installedPanels().find((p) => p.id === panelId);
        return {
            name:
                found?.name ||
                panelId
                    .replace(/^dev\.paperboard\./, "")
                    .replace(/\./g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase()),
            iconUrl: getPanelIcon(panelId),
        };
    };

    const logicCategories = createMemo(() =>
        BUILTIN_CATEGORIES.filter((c) => c.domain === "logic"),
    );

    const computerCategories = createMemo(() =>
        BUILTIN_CATEGORIES.filter((c) => c.domain === "computer"),
    );

    const panelCategories = createMemo<PanelCategory[]>(() => {
        const map = new Map<string, PanelCategory>();

        for (const trig of registeredTriggers()) {
            const schema: TriggerSchema = trig.schema || {
                id: trig.trigger,
                name: trig.trigger.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                description: "",
                template: `When ${trig.trigger.replace(/-/g, " ")}`,
            };

            let cat = map.get(trig.panelId);
            if (!cat) {
                const info = getPanelInfo(trig.panelId);
                cat = {
                    id: trig.panelId,
                    domain: "panel",
                    name: info.name,
                    icon: "extension",
                    iconUrl: info.iconUrl,
                    triggers: [],
                    actions: [],
                    sections: [],
                };
                map.set(trig.panelId, cat);
            }
            cat.triggers.push({ ...trig, schema });
        }

        for (const act of registeredActions()) {
            if (act.action.startsWith("call-function-")) continue;
            // own sync/test actions run via api, never placeable blocks
            if (act.panelId === ACTIONS_PANEL_ID) continue;
            const isInternal =
                act.action.startsWith("__") ||
                act.action === "load-config" ||
                act.schema?.name?.includes("(Internal)");

            if (isInternal) continue;

            const schema: ActionSchema = act.schema || {
                id: act.action,
                name: act.action.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                description: "",
                template: act.action.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            };

            let cat = map.get(act.panelId);
            if (!cat) {
                const info = getPanelInfo(act.panelId);
                cat = {
                    id: act.panelId,
                    domain: "panel",
                    name: info.name,
                    icon: "extension",
                    iconUrl: info.iconUrl,
                    triggers: [],
                    actions: [],
                    sections: [],
                };
                map.set(act.panelId, cat);
            }
            cat.actions.push({ ...act, schema });
        }

        const categories = Array.from(map.values());
        for (const category of categories) {
            category.sections = buildLibrarySections(
                category.triggers,
                category.actions,
            );
        }
        return categories;
    });

    const allCategories = createMemo<Category[]>(() => [
        ...logicCategories(),
        ...computerCategories(),
        ...panelCategories(),
    ]);

    const currentCategory = createMemo<Category | undefined>(() => {
        const id = selectedCategoryId();
        return allCategories().find((c) => c.id === id) || logicCategories()[0];
    });

    const currentItemCount = createMemo(() => {
        const cat = currentCategory();
        if (!cat) return 0;
        if (cat.domain === "panel") {
            return cat.triggers.length + cat.actions.length;
        }
        return cat.items.length;
    });

    const filteredFunctions = createMemo(() => {
        const q = search().trim().toLowerCase();
        const list = props.functions || [];
        if (!q) return list;
        return list.filter((fn) => fn.name.toLowerCase().includes(q));
    });

    const searchResults = createMemo(() => {
        const query = search().toLowerCase().trim();
        if (!query) return [];

        const results: {
            categoryName: string;
            categoryIcon: string;
            categoryIconUrl?: string;
            items: {
                data: ActionInfo | TriggerInfo;
                isTrigger: boolean;
                iconUrl?: string;
            }[];
        }[] = [];

        for (const cat of allCategories()) {
            const matchedInCat: {
                data: ActionInfo | TriggerInfo;
                isTrigger: boolean;
                iconUrl?: string;
            }[] = [];

            if (cat.domain === "panel") {
                for (const trig of cat.triggers) {
                    const name = trig.schema?.name || trig.trigger;
                    const desc = trig.schema?.description || "";
                    const template = trig.schema?.template || "";
                    if (
                        name.toLowerCase().includes(query) ||
                        desc.toLowerCase().includes(query) ||
                        template.toLowerCase().includes(query)
                    ) {
                        matchedInCat.push({
                            data: trig,
                            isTrigger: true,
                            iconUrl: cat.iconUrl,
                        });
                    }
                }

                for (const act of cat.actions) {
                    const name = act.schema?.name || act.action;
                    const desc = act.schema?.description || "";
                    const template = act.schema?.template || "";
                    if (
                        name.toLowerCase().includes(query) ||
                        desc.toLowerCase().includes(query) ||
                        template.toLowerCase().includes(query)
                    ) {
                        matchedInCat.push({
                            data: act,
                            isTrigger: false,
                            iconUrl: cat.iconUrl,
                        });
                    }
                }
            } else {
                for (const item of cat.items) {
                    const name =
                        item.schema?.name ||
                        (item as any).action ||
                        (item as any).trigger ||
                        "";
                    const desc = item.schema?.description || "";
                    const template = item.schema?.template || "";
                    if (
                        name.toLowerCase().includes(query) ||
                        desc.toLowerCase().includes(query) ||
                        template.toLowerCase().includes(query)
                    ) {
                        matchedInCat.push({
                            data: item,
                            isTrigger: Boolean(
                                (item as any).trigger || (item as any).isTrigger,
                            ),
                            iconUrl: undefined,
                        });
                    }
                }
            }

            if (matchedInCat.length > 0) {
                results.push({
                    categoryName: cat.name,
                    categoryIcon: cat.icon,
                    categoryIconUrl: (cat as any).iconUrl,
                    items: matchedInCat,
                });
            }
        }

        return results;
    });

    const searchMatchCount = createMemo(() => {
        return searchResults().reduce((acc, g) => acc + g.items.length, 0);
    });

    let libraryScrollRef: HTMLDivElement | undefined;

    const panelSections = (): LibrarySection[] => {
        const category = currentCategory();
        return category?.domain === "panel" ? category.sections : [];
    };

    // sections are navigated with a select above the list; the headers
    // themselves stay in flow (sticky stacking read as noise)
    const [jumpSection, setJumpSection] = createSignal("");

    const scrollToSection = (id: string) => {
        const container = libraryScrollRef;
        if (!container) return;
        const target = container.querySelector(
            `[data-library-section="${CSS.escape(id)}"]`,
        ) as HTMLElement | null;
        if (!target) return;
        const top =
            target.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop;
        container.scrollTo({ top, behavior: "smooth" });
    };

    createEffect(() => {
        // a section name from another panel must not linger in the select
        selectedCategoryId();
        search();
        setJumpSection("");
    });

    const handleJump = (id: string) => {
        setJumpSection(id);
        scrollToSection(id);
    };

    const headerIcon = (section: LibrarySection) => section.icon || "category";

    const handlePointerDownItem = (
        item: ActionInfo | TriggerInfo,
        isTrigger: boolean,
        e: PointerEvent,
        customIconUrl?: string,
    ) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const grabOffset = {
            x: Math.round(e.clientX - rect.left),
            y: Math.round(e.clientY - rect.top),
        };

        const iconUrl =
            customIconUrl !== undefined
                ? customIconUrl
                : item.panelId.startsWith("builtin.")
                  ? undefined
                  : getPanelIcon(item.panelId);

        props.onStartDrag(
            item,
            isTrigger,
            { x: e.clientX, y: e.clientY },
            grabOffset,
            iconUrl,
        );
    };

    return (
        <>
            <Show when={isCollapsed()}>
                <div class="library-toggle-collapsed">
                    <PaperButton size="large"
                        onClick={() => setIsCollapsed(false)}
                        title="Open Actions Library"
                    >
                        <PaperIcon>menu_open</PaperIcon>
                        Library
                    </PaperButton>
                </div>
            </Show>

            <Show when={!isCollapsed()}>
                <div class="library-sidebar">
                    <div class="library-rail-container">
                        <PaperRail
                            name="library-category"
                            value={selectedCategoryId()}
                            onValueChange={(val) => {
                                setSelectedCategoryId(String(val));
                                setSearch("");
                            }}
                            showLabels={true}
                        >
                            <For each={logicCategories()}>
                                {(cat) => (
                                    <>
                                        <PaperRailItem
                                            value={cat.id}
                                            icon={cat.icon}
                                            label={cat.name}
                                            showLabel={true}
                                        />
                                        <Show when={cat.id === "logic.utility"}>
                                            <PaperRailItem
                                                value="functions"
                                                icon="functions"
                                                label="Functions"
                                                showLabel={true}
                                            />
                                        </Show>
                                    </>
                                )}
                            </For>

                            <PaperSeparator
                                direction="horizontal"
                                class="library-rail-separator"
                            />

                            <For each={computerCategories()}>
                                {(cat) => (
                                    <PaperRailItem
                                        value={cat.id}
                                        icon={cat.icon}
                                        label={cat.name}
                                        showLabel={true}
                                    />
                                )}
                            </For>

                            <Show when={panelCategories().length > 0}>
                                <PaperSeparator
                                    direction="horizontal"
                                    class="library-rail-separator"
                                />

                                <For each={panelCategories()}>
                                    {(cat) => (
                                        <PaperRailItem
                                            value={cat.id}
                                            icon={
                                                cat.iconUrl ? (
                                                    <PaperIcon src={cat.iconUrl} />
                                                ) : (
                                                    <PaperIcon monogram>
                                                        {cat.name.slice(0, 2).toUpperCase()}
                                                    </PaperIcon>
                                                )
                                            }
                                            label={cat.name}
                                            showLabel={true}
                                        />
                                    )}
                                </For>
                            </Show>
                        </PaperRail>
                    </div>

                    <div class="library-content">
                        <div class="library-header">
                            <PaperFlex direction="column" gap="half" fullWidth>
                                <div class="library-header-top-row">
                                    <Show when={!search()}>
                                        <PaperFlex
                                            direction="row"
                                            align="center"
                                            gap="half"
                                        >
                                            <Show when={currentCategory()?.iconUrl}>
                                                <PaperIcon src={currentCategory()!.iconUrl} />
                                            </Show>
                                            <Show when={!currentCategory()?.iconUrl}>
                                                <PaperIcon>
                                                    {currentCategory()?.icon || "extension"}
                                                </PaperIcon>
                                            </Show>
                                            <PaperText preset="header-small">
                                                {selectedCategoryId() === "functions"
                                                    ? "Functions"
                                                    : currentCategory()?.name}
                                            </PaperText>
                                            <PaperBadge variant="monochrome">
                                                {selectedCategoryId() === "functions"
                                                    ? (props.functions?.length || 0) * 2
                                                    : currentItemCount()}
                                            </PaperBadge>
                                        </PaperFlex>
                                    </Show>

                                    <Show when={search()}>
                                        <PaperFlex
                                            direction="row"
                                            align="center"
                                            gap="half"
                                        >
                                            <PaperIcon>search</PaperIcon>
                                            <PaperText preset="header-small">
                                                Search
                                            </PaperText>
                                            <PaperBadge variant="monochrome">
                                                {searchMatchCount()}
                                            </PaperBadge>
                                        </PaperFlex>
                                    </Show>

                                    <PaperButton size="tiny"
                                        icon
                                        onClick={() => setIsCollapsed(true)}
                                        title="Collapse Library">
                                        <PaperIcon>chevron_left</PaperIcon>
                                    </PaperButton>
                                </div>

                                <PaperInput
                                    fullWidth
                                    placeholder="Search actions..."
                                    value={search()}
                                    onInput={(e) =>
                                        setSearch(e.currentTarget.value)
                                    }
                                />

                                <Show when={!search() && panelSections().length > 1}>
                                    <PaperSelectMenu
                                        name="librarySectionJump"
                                        fullWidth
                                        value={jumpSection()}
                                        placeholder="Jump to a section..."
                                        onValueChange={(value) =>
                                            handleJump(String(value))
                                        }
                                    >
                                        <For each={panelSections()}>
                                            {(section) => (
                                                <PaperSelectMenuItem
                                                    value={section.id}
                                                    icon={headerIcon(section)}
                                                >
                                                    {section.name}
                                                </PaperSelectMenuItem>
                                            )}
                                        </For>
                                    </PaperSelectMenu>
                                </Show>
                            </PaperFlex>
                        </div>

                        <div class="library-scroll" ref={libraryScrollRef}>
                            <Show when={selectedCategoryId() === "functions"}>
                                <Show when={(props.functions?.length || 0) > 0}>
                                    <PaperButton onClick={openCreateModal} style={{ width: "100%" }}>
                                        <PaperIcon>add</PaperIcon>
                                        Create Function
                                    </PaperButton>
                                </Show>

                                <Show when={(props.functions?.length || 0) === 0}>
                                    <div class="library-empty">
                                        <PaperIcon>functions</PaperIcon>
                                        <PaperText preset="body">
                                            No functions yet.
                                        </PaperText>
                                        <PaperButton size="tiny" onClick={openCreateModal}>
                                            <PaperIcon>add</PaperIcon>
                                            Create Function
                                        </PaperButton>
                                    </div>
                                </Show>

                                <Show
                                    when={filteredFunctions().length === 0 && (props.functions?.length || 0) > 0}
                                >
                                    <div class="library-empty">
                                        <PaperIcon>search_off</PaperIcon>
                                        <PaperText preset="body">
                                            No functions matching "{search()}"
                                        </PaperText>
                                    </div>
                                </Show>

                                <For each={filteredFunctions()}>
                                    {(fn) => {
                                        const trigSchema = buildTriggerSchema(fn);
                                        const callSchema = buildCallSchema(fn);
                                        return (
                                            <div class="library-function-group">
                                                <div class="library-function-header">
                                                    <div class="library-function-title">
                                                        <PaperIcon>functions</PaperIcon>
                                                        <PaperText size={2} weight={700}>
                                                            {fn.name}
                                                        </PaperText>
                                                        <PaperBadge variant="monochrome">
                                                            {fn.params.length}
                                                        </PaperBadge>
                                                    </div>
                                                    <div class="library-function-actions">
                                                        <PaperButton size="tiny"
                                                            icon
                                                            onClick={() => openRenameModal(fn)}
                                                            title={`Rename ${fn.name}`}>
                                                            <PaperIcon>edit</PaperIcon>
                                                        </PaperButton>
                                                        <PaperButton size="tiny"
                                                            icon
                                                            onClick={() => props.onDeleteFunction?.(fn.id)}
                                                            title={`Delete ${fn.name}`}>
                                                            <PaperIcon>delete</PaperIcon>
                                                        </PaperButton>
                                                    </div>
                                                </div>

                                                <PaperText size={1} color="text-subtle" class="library-function-caption">
                                                    Trigger
                                                </PaperText>
                                                <div
                                                    class="library-block-wrapper"
                                                    onPointerDown={(e) =>
                                                        handlePointerDownItem(
                                                            {
                                                                panelId: "builtin.function",
                                                                trigger: trigSchema.id,
                                                                schema: trigSchema,
                                                            } as TriggerInfo,
                                                            true,
                                                            e,
                                                            undefined,
                                                        )
                                                    }
                                                >
                                                    <ActionBlock
                                                        action={trigSchema}
                                                        isTrigger={true}
                                                        static={true}
                                                    />
                                                </div>

                                                <PaperText size={1} color="text-subtle" class="library-function-caption">
                                                    Call
                                                </PaperText>
                                                <div
                                                    class="library-block-wrapper"
                                                    onPointerDown={(e) =>
                                                        handlePointerDownItem(
                                                            {
                                                                panelId: "builtin.function",
                                                                action: callSchema.id,
                                                                schema: callSchema,
                                                            } as ActionInfo,
                                                            false,
                                                            e,
                                                            undefined,
                                                        )
                                                    }
                                                >
                                                    <ActionBlock
                                                        action={callSchema}
                                                        isTrigger={false}
                                                        static={true}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    }}
                                </For>
                            </Show>

                            <Show when={search().trim().length > 0 && selectedCategoryId() !== "functions"}>
                                <Show when={searchResults().length === 0}>
                                    <div class="library-empty">
                                        <PaperIcon>search_off</PaperIcon>
                                        <PaperText preset="body">
                                            No actions matching "{search()}"
                                        </PaperText>
                                    </div>
                                </Show>

                                <For each={searchResults()}>
                                    {(group) => (
                                        <div class="library-search-group">
                                            <div class="library-section-header">
                                                <Show when={group.categoryIconUrl}>
                                                    <PaperIcon src={group.categoryIconUrl} />
                                                </Show>
                                                <Show when={!group.categoryIconUrl}>
                                                    <PaperIcon>{group.categoryIcon}</PaperIcon>
                                                </Show>
                                                <PaperText size={2} weight={700}>
                                                    {group.categoryName}
                                                </PaperText>
                                                <PaperBadge variant="monochrome">
                                                    {group.items.length}
                                                </PaperBadge>
                                            </div>

                                            <For each={group.items}>
                                                {(item) => (
                                                    <div
                                                        class="library-block-wrapper"
                                                        onPointerDown={(e) =>
                                                            handlePointerDownItem(
                                                                item.data,
                                                                item.isTrigger,
                                                                e,
                                                                item.iconUrl,
                                                            )
                                                        }
                                                    >
                                                        <ActionBlock
                                                            action={
                                                                item.data.schema || {
                                                                    id:
                                                                        (item.data as any).action ||
                                                                        (item.data as any).trigger,
                                                                    name:
                                                                        (item.data as any).action ||
                                                                        (item.data as any).trigger,
                                                                    description: "",
                                                                }
                                                            }
                                                            isTrigger={item.isTrigger}
                                                            iconSrc={item.iconUrl}
                                                            static={true}
                                                        />
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    )}
                                </For>
                            </Show>

                            <Show when={!search().trim().length && selectedCategoryId() !== "functions"}>
                                <Show when={currentCategory()?.domain === "panel"}>
                                    <For each={panelSections()}>
                                        {(section) => (
                                            <div
                                                class="library-category-section"
                                                data-library-section={section.id}
                                            >
                                                <div class="library-section-header library-category-header">
                                                    <PaperIcon>
                                                        {headerIcon(section)}
                                                    </PaperIcon>
                                                    <PaperText size={2} weight={700}>
                                                        {section.name}
                                                    </PaperText>
                                                    <PaperBadge variant="monochrome">
                                                        {section.triggers.length +
                                                            section.actions.length}
                                                    </PaperBadge>
                                                </div>

                                                <For each={section.triggers}>
                                                    {(trig) => (
                                                        <div
                                                            class="library-block-wrapper"
                                                            onPointerDown={(e) =>
                                                                handlePointerDownItem(
                                                                    trig,
                                                                    true,
                                                                    e,
                                                                    (currentCategory() as PanelCategory).iconUrl,
                                                                )
                                                            }
                                                        >
                                                            <ActionBlock
                                                                action={
                                                                    trig.schema || {
                                                                        id: trig.trigger,
                                                                        name: trig.trigger,
                                                                        description: "",
                                                                    }
                                                                }
                                                                isTrigger={true}
                                                                iconSrc={(currentCategory() as PanelCategory).iconUrl}
                                                                static={true}
                                                            />
                                                        </div>
                                                    )}
                                                </For>

                                                <For each={section.actions}>
                                                    {(act) => (
                                                        <div
                                                            class="library-block-wrapper"
                                                            onPointerDown={(e) =>
                                                                handlePointerDownItem(
                                                                    act,
                                                                    false,
                                                                    e,
                                                                    (currentCategory() as PanelCategory).iconUrl,
                                                                )
                                                            }
                                                        >
                                                            <ActionBlock
                                                                action={
                                                                    act.schema || {
                                                                        id: act.action,
                                                                        name: act.action,
                                                                        description: "",
                                                                    }
                                                                }
                                                                isTrigger={false}
                                                                iconSrc={(currentCategory() as PanelCategory).iconUrl}
                                                                static={true}
                                                            />
                                                        </div>
                                                    )}
                                                </For>
                                            </div>
                                        )}
                                    </For>
                                </Show>

                                <Show when={currentCategory()?.domain !== "panel"}>
                                    <Show when={(currentCategory() as BuiltinCategory)?.items?.length === 0}>
                                        <div class="library-empty">
                                            <PaperIcon>extension_off</PaperIcon>
                                            <PaperText preset="body">
                                                No actions in this category
                                            </PaperText>
                                        </div>
                                    </Show>

                                    <For each={(currentCategory() as BuiltinCategory)?.items}>
                                        {(act) => {
                                            const isTrig = Boolean(
                                                (act as any).trigger || (act as any).isTrigger,
                                            );
                                            return (
                                                <div
                                                    class="library-block-wrapper"
                                                    onPointerDown={(e) =>
                                                        handlePointerDownItem(
                                                            act,
                                                            isTrig,
                                                            e,
                                                            undefined,
                                                        )
                                                    }
                                                >
                                                    <ActionBlock
                                                        action={
                                                            act.schema || {
                                                                id:
                                                                    (act as any).trigger ||
                                                                    (act as any).action,
                                                                name:
                                                                    (act as any).trigger ||
                                                                    (act as any).action,
                                                                description: "",
                                                            }
                                                        }
                                                        isTrigger={isTrig}
                                                        static={true}
                                                    />
                                                </div>
                                            );
                                        }}
                                    </For>
                                </Show>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>

            <PaperModal
                open={createOpen()}
                onClose={() => setCreateOpen(false)}
                title={editingId() ? "Rename Function" : "Create Function"}
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            variant="text"
                            onClick={() => setCreateOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="brand"
                            onClick={handleConfirmCreate}
                            disabled={!draftValid()}>
                            {editingId() ? "Save" : "Create"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="full" fullWidth>
                    <PaperInput
                        fullWidth
                        placeholder="Function name"
                        value={draftName()}
                        onInput={(e) => setDraftName(e.currentTarget.value)}
                    />

                    <Show when={!editingId()}>
                        <For each={draftParams}>
                            {(param, index) => (
                                <div class="library-param-row">
                                    <PaperInput
                                        compact
                                        fullWidth
                                        placeholder="Variable name"
                                        value={param.name}
                                        onInput={(e) => {
                                            setDraftParams(index(), "name", e.currentTarget.value);
                                        }}
                                    />
                                    <PaperSelectMenu
                                        name={`param-type-${index()}`}
                                        value={param.type}
                                        onValueChange={(v) => {
                                            setDraftParams(index(), "type", String(v));
                                        }}
                                    >
                                        <For each={FUNCTION_PARAM_TYPES}>
                                            {(t) => (
                                                <PaperSelectMenuItem value={t.id}>
                                                    {t.label}
                                                </PaperSelectMenuItem>
                                            )}
                                        </For>
                                    </PaperSelectMenu>
                                    <PaperButton size="tiny"
                                        icon
                                        onClick={() =>
                                            setDraftParams((prev) =>
                                                prev.filter((_, i) => i !== index()),
                                            )
                                        }
                                        title="Remove variable">
                                        <PaperIcon>delete</PaperIcon>
                                    </PaperButton>
                                </div>
                            )}
                        </For>

                        <PaperButton
                            variant="text"
                            onClick={() =>
                                setDraftParams((prev) => [...prev, { name: "", type: "string" }])
                            }>
                            <PaperIcon>add</PaperIcon>
                            Add Variable
                        </PaperButton>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
