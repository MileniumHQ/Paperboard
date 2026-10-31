// The Library: a rail of categories, a search, and the blocks of the chosen
// category, each one dragged out onto the canvas.
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
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
} from "@mileniumhq/paperui";
import {
    actions as actionsApi,
    panels as panelsApi,
    panelAssetUrl,
    type ActionInfo,
    type PanelItem,
    type ProjectInfo,
} from "@mileniumhq/paperapi";
import { BUILTIN_CATEGORIES } from "../lib/builtins";
import type { FunctionDef, FunctionParam } from "../lib/functions";
import { loadLibraryLists } from "../lib/libraryLoad";
import type { LibrarySection } from "../lib/librarySections";
import {
    categorySections,
    panelCategoriesFrom,
    searchLibrary,
    shownProject,
    type Category,
} from "../lib/libraryCategories";
import FunctionList from "./library/FunctionList";
import FunctionModal from "./library/FunctionModal";
import SearchResults from "./library/SearchResults";
import CategoryItems from "./library/CategoryItems";
import "./ActionLibrary.css";

export interface ActionLibraryProps {
    onStartDrag: (
        item: ActionInfo,
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

export default function ActionLibrary(props: ActionLibraryProps) {
    const [selectedCategoryId, setSelectedCategoryId] = createSignal<string>("logic.timing");
    const [search, setSearch] = createSignal("");
    const [installedPanels, setInstalledPanels] = createSignal<PanelItem[]>([]);
    const [registeredActions, setRegisteredActions] = createSignal<ActionInfo[]>([]);
    const [registeredProjects, setRegisteredProjects] = createSignal<ProjectInfo[]>([]);
    // the project each panel's Library shows, by panel id
    const [chosenProjects, setChosenProjects] = createSignal<Record<string, string>>({});
    const [isCollapsed, setIsCollapsed] = createSignal(false);

    const [functionModal, setFunctionModal] = createSignal<FunctionDef | "new" | null>(null);

    // a failed read keeps what was last loaded and says so, with Retry;
    // only the latest read lands, so a slow earlier one can't overwrite it
    const [loadError, setLoadError] = createSignal("");
    let loadRequest = 0;
    const loadLibrary = async () => {
        const mine = ++loadRequest;
        const result = await loadLibraryLists({ panels: () => panelsApi.list(), actions: () => actionsApi.list(), projects: () => actionsApi.listProjects() });
        if (mine !== loadRequest) return;
        if (result.kind === "failed") {
            setLoadError(result.message);
            return;
        }
        setInstalledPanels(result.panels);
        setRegisteredActions(result.actions);
        setRegisteredProjects(result.projects);
        setLoadError("");
    };

    onMount(() => {
        loadLibrary();
        const unsub = (actionsApi as any).onRegistryChange?.(() => {
            loadLibrary();
        });
        onCleanup(() => {
            unsub?.();
            loadRequest++;
        });
    });

    const getPanelIcon = (panelId: string): string => {
        const found = installedPanels().find((p) => p.id === panelId);
        if (found?.iconUrl) return found.iconUrl;
        // the sibling's own origin on this panel's computer, in whichever
        // host (desktop or browser mode) this panel runs
        return panelAssetUrl(panelId, found?.icon || "branding/icon.png");
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

    const panelCategories = createMemo(() => panelCategoriesFrom(registeredActions(), getPanelInfo, registeredProjects()));

    const allCategories = createMemo<Category[]>(() => [
        ...logicCategories(),
        ...panelCategories(),
    ]);

    const currentCategory = createMemo<Category | undefined>(() => {
        const id = selectedCategoryId();
        return allCategories().find((c) => c.id === id) || logicCategories()[0];
    });

    const currentProjects = createMemo(() => {
        const cat = currentCategory();
        return cat?.domain === "panel" ? cat.projects : [];
    });

    const currentProject = createMemo(() => {
        const cat = currentCategory();
        return cat?.domain === "panel" ? shownProject(cat, chosenProjects()[cat.id]) : null;
    });

    const panelSections = createMemo((): LibrarySection[] => {
        const cat = currentCategory();
        return cat?.domain === "panel" ? categorySections(cat, currentProject()?.id ?? null) : [];
    });

    const currentItemCount = createMemo(() => {
        const cat = currentCategory();
        if (!cat) return 0;
        if (cat.domain === "panel") {
            return panelSections().reduce((n, section) => n + section.triggers.length + section.actions.length, 0);
        }
        return cat.items.length;
    });

    const filteredFunctions = createMemo(() => {
        const q = search().trim().toLowerCase();
        const list = props.functions || [];
        if (!q) return list;
        return list.filter((fn) => fn.name.toLowerCase().includes(q));
    });

    const searchResults = createMemo(() => searchLibrary(allCategories(), search()));

    const searchMatchCount = createMemo(() => {
        return searchResults().reduce((acc, g) => acc + g.items.length, 0);
    });

    let libraryScrollRef: HTMLDivElement | undefined;

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
        currentProject();
        search();
        setJumpSection("");
    });

    const handleJump = (id: string) => {
        setJumpSection(id);
        scrollToSection(id);
    };

    const headerIcon = (section: LibrarySection) => section.icon || "category";

    const handlePointerDownItem = (
        item: ActionInfo,
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
                    <PaperButton
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
                        <Show when={loadError()}>
                            <PaperQuote variant="danger" icon="warning" title="Panels' blocks not loaded" role="alert">
                                <PaperFlex direction="column" gap="half">
                                    {loadError()}
                                    <PaperButton size="tiny" onClick={() => void loadLibrary()}>
                                        Retry
                                    </PaperButton>
                                </PaperFlex>
                            </PaperQuote>
                        </Show>
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
                                            <PaperText preset="heading">
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
                                            <PaperText preset="heading">
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
                                    icon="search"
                                    placeholder="Search actions..."
                                    value={search()}
                                    onInput={(e) =>
                                        setSearch(e.currentTarget.value)
                                    }
                                />

                                <Show when={!search() && currentProject()}>
                                    {(project) => (
                                        <PaperSelectMenu
                                            name="libraryProject"
                                            fullWidth
                                            value={project().id}
                                            aria-label="Project"
                                            onValueChange={(value) => {
                                                const cat = currentCategory();
                                                if (cat) setChosenProjects((chosen) => ({ ...chosen, [cat.id]: String(value) }));
                                            }}
                                        >
                                            <For each={currentProjects()}>
                                                {(item) => (
                                                    <PaperSelectMenuItem value={item.id} icon={item.icon || "folder"}>
                                                        {item.name}
                                                    </PaperSelectMenuItem>
                                                )}
                                            </For>
                                        </PaperSelectMenu>
                                    )}
                                </Show>

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
                                <FunctionList
                                    functions={props.functions || []}
                                    shown={filteredFunctions()}
                                    search={search()}
                                    onCreate={() => setFunctionModal("new")}
                                    onRename={(fn) => setFunctionModal(fn)}
                                    onDelete={(fn) => props.onDeleteFunction?.(fn.id)}
                                    onPress={handlePointerDownItem}
                                />
                            </Show>

                            <Show when={search().trim().length > 0 && selectedCategoryId() !== "functions"}>
                                <SearchResults search={search()} groups={searchResults()} onPress={handlePointerDownItem} />
                            </Show>

                            <Show when={!search().trim().length && selectedCategoryId() !== "functions"}>
                                <CategoryItems category={currentCategory()} sections={panelSections()} onPress={handlePointerDownItem} />
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>

            <FunctionModal
                target={functionModal()}
                onClose={() => setFunctionModal(null)}
                onCreate={(name, params) => props.onCreateFunction?.(name, params)}
                onRename={(fid, name) => props.onRenameFunction?.(fid, name)}
            />
        </>
    );
}
