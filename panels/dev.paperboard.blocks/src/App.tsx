// The Blocks editor: the Library (a rail of categories, and the chosen
// one's blocks in Blockly's flyout), the canvas, Run and Stop above it, and
// the run log below. Edits save as you make them; the service runs the flows.
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import * as Blockly from "blockly";
import { blocksApi, createPanelBridge, panelAssetUrl, panelsApi, type BlockInfo, type BlockProjectInfo, type PanelItem } from "@mileniumhq/paperapi";
import { PaperButton, PaperEffect, PaperFlex, PaperIcon, PaperText } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { BUILTIN_BLOCKS, BUILTIN_SECTIONS, builtinPlaceholder, choicesSources, PROPERTIES_CATEGORY, registryDefinitions, type Definitions } from "./lib/blockDefs";
import { refreshChoices, registerChoicesField } from "./lib/choicesField";
import { LIBRARY_FLYOUT, setLibraryTop, uiGap } from "./lib/libraryFlyout";
import { loadBlockFonts, PAPER_RENDERER, paperTheme } from "./lib/paperRenderer";
import { assignPanelStyles, setPanelIcons } from "./lib/blockStyles";
import { HEADING_KIND, type HeadingInfo } from "./lib/libraryHeading";
import { setTextPlaceholders } from "./lib/textField";
import { addTrash, type TrashState } from "./lib/trashZone";
import { tokenPixels } from "./lib/tokens";
import { Console } from "./Console";
import { paperContextMenus } from "./lib/contextMenu";
import { errorMessage } from "./lib/failure";
import type { SavedWorkspace } from "./lib/interpreter";
import { DEFAULT_STATE, PANEL_ID, SERVICE_ACTIONS, type PanelState, type SavedFlows } from "./panel";
import { BlocklyDialogs } from "./BlocklyDialogs";
import { LibraryHeader, LibraryRail, type LibraryCategory } from "./Library";
import styles from "./App.module.css";

const SAVE_DELAY_MS = 400;

const bridge = createPanelBridge<PanelState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });

type Json = Record<string, unknown>;

/** Replaces block definitions, so a registry change redefines them without a warning per block. */
function define(blocks: Json[]): void {
    for (const block of blocks) delete Blockly.Blocks[block.type as string];
    Blockly.common.defineBlocksWithJsonArray(blocks);
}

/** What the registry offers, as the Library shows it. */
interface Registry {
    panels: PanelItem[];
    projects: BlockProjectInfo[];
    sections: Definitions["sections"];
}

/** A run of the list under one heading. */
interface Group {
    label?: string;
    icon?: HeadingInfo["icon"];
    blocks: Json[];
}

/** A panel's category has no symbol of its own, as in the Actions library. */
const CATEGORY_SYMBOL = "category";
const PROPERTIES_SYMBOL = "tune";

const builtinId = (name: string) => `builtin:${name}`;
const panelCategoryId = (id: string) => `panel:${id}`;

const HEADING_CLASSES: HeadingInfo["classes"] = { heading: styles.heading!, icon: styles.headingIcon!, badge: styles.headingBadge!, badgeText: styles.headingBadgeText! };

/** The list as Blockly's flyout takes it: each group's heading, then its blocks. */
function flyoutContents(groups: Group[]): Json[] {
    // a heading after blocks gets more room above it than a block does
    return groups.flatMap((g, i) => {
        if (!g.label) return g.blocks;
        const heading: HeadingInfo = {
            kind: HEADING_KIND,
            text: g.label,
            icon: g.icon ?? { symbol: CATEGORY_SYMBOL },
            count: g.blocks.filter((b) => b.kind === "block").length,
            classes: HEADING_CLASSES,
        };
        return [...(i > 0 ? [{ kind: "sep", gap: uiGap() * 2 }] : []), heading as unknown as Json, ...g.blocks];
    });
}

export default function App() {
    let host!: HTMLDivElement;
    let trashTile!: HTMLDivElement;
    const [trash, setTrash] = createSignal<TrashState>({ dragging: false, over: false });
    let workspace: Blockly.WorkspaceSvg | undefined;
    const [state, setState] = createSignal<PanelState>(bridge.getState());
    const [problem, setProblem] = createSignal<string | null>(null);
    const [registry, setRegistry] = createSignal<Registry>({ panels: [], projects: [], sections: [] });
    const [selected, setSelected] = createSignal(builtinId(BUILTIN_SECTIONS[0]!.name));
    const [chosenProjects, setChosenProjects] = createSignal<Record<string, string>>({});
    const [search, setSearch] = createSignal("");
    const [collapsed, setCollapsed] = createSignal(false);
    const [ready, setReady] = createSignal(false);
    // bumped each time the blocks are (re)defined, so the list draws them anew
    const [definitions, setDefinitions] = createSignal(0);
    // a variable made, renamed or removed changes the Variables list
    const [variablesVersion, setVariablesVersion] = createSignal(0);
    // each toolbox block's text as it reads, for search: by the block itself,
    // since Blockly writes to a toolbox block's JSON once it shows it
    const blockText = new WeakMap<Json, string>();
    const scratch = new Blockly.Workspace();
    // the schemas of the blocks on the canvas, as last seen: saved with the flows
    let schemas: SavedFlows["schemas"] = {};
    let live = new Set<string>();
    let loading = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let shownErrors = 0;

    const fail = (what: string) => (err: unknown) => setProblem(`${what}: ${errorMessage(err)}`);

    const panelName = (id: string) => registry().panels.find((p) => p.id === id)?.name ?? id;
    const panelIcon = (id: string) => {
        const found = registry().panels.find((p) => p.id === id);
        return found?.iconUrl ?? panelAssetUrl(id, found?.icon || "branding/icon.png");
    };

    const builtins = createMemo<LibraryCategory[]>(() => BUILTIN_SECTIONS.map((s) => ({ id: builtinId(s.name), name: s.name, icon: s.icon })));
    const panels = createMemo<LibraryCategory[]>(() =>
        [...new Set(registry().sections.map((s) => s.panelId))]
            .map((id) => ({ id: panelCategoryId(id), name: panelName(id), iconUrl: panelIcon(id) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
    );
    const category = createMemo(() => [...builtins(), ...panels()].find((c) => c.id === selected()));

    const shownPanel = () => (selected().startsWith("panel:") ? selected().slice("panel:".length) : null);
    const projectsOf = (id: string) => registry().projects.filter((p) => p.panelId === id && registry().sections.some((s) => s.panelId === id && s.project === p.id));
    const shownProject = createMemo(() => {
        const id = shownPanel();
        if (!id) return null;
        const projects = projectsOf(id);
        return projects.find((p) => p.id === chosenProjects()[id])?.id ?? projects[0]?.id ?? null;
    });

    /** A panel's blocks under their categories: its own, then the chosen project's, then every property. */
    const panelGroups = (id: string, project: string | null): Group[] => {
        const rank = (s: Definitions["sections"][number]) => (s.category === PROPERTIES_CATEGORY ? 2 : s.project ? 1 : 0);
        const groups: Group[] = [];
        for (const s of registry()
            .sections.filter((s) => s.panelId === id && (!s.project || s.project === project))
            .sort((a, b) => rank(a) - rank(b))) {
            // the panel's and the project's categories of one name read as one
            const same = groups.find((g) => g.label === s.category);
            if (same) same.blocks = [...same.blocks, ...s.contents];
            else groups.push({ ...(s.category ? { label: s.category, icon: { symbol: s.category === PROPERTIES_CATEGORY ? PROPERTIES_SYMBOL : CATEGORY_SYMBOL } } : {}), blocks: s.contents });
        }
        return groups;
    };

    /** What the list shows now: the category's blocks, or every block the search finds. */
    const groups = createMemo<Group[]>(() => {
        variablesVersion();
        const query = search().trim().toLowerCase();
        if (query) {
            const projectName = (panel: string, project: string) => registry().projects.find((p) => p.panelId === panel && p.id === project)?.name ?? project;
            const all: Group[] = [
                ...BUILTIN_SECTIONS.filter((s) => !s.custom).map((s) => ({ label: s.name, icon: { symbol: s.icon }, blocks: s.contents })),
                ...registry().sections.map((s) => ({
                    icon: { src: panelIcon(s.panelId) },
                    // a category named for its panel isn't said twice
                    label: [panelName(s.panelId), s.project ? projectName(s.panelId, s.project) : null, s.category === panelName(s.panelId) ? null : s.category].filter(Boolean).join(" · "),
                    blocks: s.contents,
                })),
            ];
            return all.map((g) => ({ ...g, blocks: g.blocks.filter((b) => b.kind === "block" && textOf(b).includes(query)) })).filter((g) => g.blocks.length);
        }
        const builtin = BUILTIN_SECTIONS.find((s) => builtinId(s.name) === selected());
        if (builtin) {
            if (builtin.custom === "VARIABLE") return ready() && workspace ? [{ blocks: Blockly.Variables.flyoutCategory(workspace) as unknown as Json[] }] : [];
            return [{ blocks: builtin.contents }];
        }
        const id = shownPanel();
        return id ? panelGroups(id, shownProject()) : [];
    });

    const count = createMemo(() => groups().reduce((n, g) => n + g.blocks.filter((b) => b.kind === "block").length, 0));
    const sectionNames = createMemo(() => groups().flatMap((g) => (g.label ? [g.label] : [])));

    /** A toolbox block's text as the canvas would show it, for search: read once per block. */
    function textOf(block: Json): string {
        let text = blockText.get(block);
        if (text === undefined) {
            const { kind: _kind, ...blockState } = block;
            const made = Blockly.serialization.blocks.append(blockState as unknown as Blockly.serialization.blocks.State, scratch);
            text = made.toString().toLowerCase();
            made.dispose(false);
            blockText.set(block, text);
        }
        return text;
    }

    /** Defines every block the registry and the saved flows name, and keeps what the Library shows. */
    async function refreshBlocks(saved: SavedFlows["schemas"]): Promise<void> {
        const [entries, panelList, projects] = await Promise.all([blocksApi.list(), panelsApi.list(), blocksApi.projects()]);
        // ask for every dropdown's choices now, so a loaded flow shows them; one that fails says so
        await Promise.all(
            choicesSources(entries).map((source) =>
                refreshChoices(source).catch((err: unknown) =>
                    setProblem(`The choices for ${panelList.find((p) => p.id === source.panelId)?.name ?? source.panelId} couldn't be loaded: ${errorMessage(err)}`),
                ),
            ),
        );
        // each panel's colour, worked out over every panel at once so two never share one
        assignPanelStyles([...entries.map((e) => e.panelId), ...Object.values(saved).map((s) => s.panelId)]);
        const liveDefs = registryDefinitions(entries, projects);
        live = new Set(Object.keys(liveDefs.schemas));
        // a block whose panel is away keeps the shape it was saved with
        const away: BlockInfo[] = Object.entries(saved)
            .filter(([type]) => !live.has(type))
            .map(([, s]) => ({ panelId: s.panelId, entry: s.entry, schema: s.schema }));
        const awayDefs = registryDefinitions(away);
        define([...BUILTIN_BLOCKS, ...awayDefs.blocks, ...liveDefs.blocks]);
        schemas = { ...awayDefs.schemas, ...liveDefs.schemas };
        setRegistry({ panels: panelList, projects, sections: liveDefs.sections });
        setDefinitions((n) => n + 1);
    }

    /** Marks the blocks whose panel isn't offering them right now. */
    function markAway(): void {
        if (!workspace) return;
        for (const block of workspace.getAllBlocks(false)) {
            const saved = schemas[block.type];
            if (!saved) continue;
            block.setWarningText(live.has(block.type) ? null : `${saved.schema.name} isn't available: its panel isn't running`, "away");
        }
    }

    function save(): void {
        if (!workspace) return;
        const saved = Blockly.serialization.workspaces.save(workspace) as SavedWorkspace;
        const used = new Set(workspace.getAllBlocks(false).map((b) => b.type));
        const flows: SavedFlows = { workspace: saved, schemas: Object.fromEntries(Object.entries(schemas).filter(([type]) => used.has(type))) };
        bridge.call(SERVICE_ACTIONS.save, flows).then(() => setProblem(null), fail("Your changes weren't saved"));
    }

    function showErrors(next: PanelState): void {
        if (!workspace) return;
        for (const entry of next.log.slice(shownErrors)) {
            if (entry.level === "error" && entry.blockId) workspace.getBlockById(entry.blockId)?.setWarningText(entry.message, "run");
        }
        shownErrors = next.log.length;
    }

    /** Scrolls the list to a section's heading. */
    function jump(section: string): void {
        const flyout = workspace?.getFlyout();
        if (!flyout) return;
        const heading = flyout.getContents().filter((item) => item.getType() === HEADING_KIND)[sectionNames().indexOf(section)];
        const list = flyout.getWorkspace();
        if (!heading || !list.scrollbar) throw new Error(`The Library has no section "${section}"`);
        list.scrollbar.setY(heading.getElement().getBoundingRectangle().top * list.scale);
    }

    onMount(() => {
        registerChoicesField({ fetch: (s) => blocksApi.choices(s.panelId, s.entry, s.input), report: setProblem });
        define(BUILTIN_BLOCKS);
        setPanelIcons(panelIcon);
        // an empty socket says what goes in it: the panel's name for the input, or a built-in's
        setTextPlaceholders((parent, input) => {
            if (!parent || !input) return builtinPlaceholder(null);
            const saved = schemas[parent.type];
            if (!saved) return builtinPlaceholder(input);
            if (saved.schema.kind === "type") return saved.schema.name;
            const named = "inputs" in saved.schema ? saved.schema.inputs?.[input]?.name : undefined;
            if (!named) throw new Error(`${saved.schema.name} has no input ${input}`);
            return named;
        });
        let closed = false;
        let offRegistry: (() => void) | undefined;
        const resize = new ResizeObserver(() => workspace && Blockly.svgResize(workspace));
        const offState = bridge.onStateChange((_patch, full) => {
            setState(full);
            showErrors(full);
        });

        const start = () => {
            if (closed) return;
            paperContextMenus();
            workspace = Blockly.inject(host, {
                renderer: PAPER_RENDERER,
                theme: paperTheme(),
                toolbox: { kind: "flyoutToolbox", contents: [] },
                plugins: { flyoutsVerticalToolbox: LIBRARY_FLYOUT },
                media: "./blockly-media/",
                // the trash and zoom are PaperUI's, over the canvas (below)
                trashcan: false,
                zoom: { controls: false, wheel: true, startScale: 1 },
                // Actions' dots: one at every double gap, drawn by App.module.css
                grid: { spacing: tokenPixels("--paper-uigap") * 2, length: 1, colour: "transparent", snap: false },
                move: { scrollbars: true, drag: true, wheel: false },
            });
            resize.observe(host);
            addTrash(workspace, trashTile, setTrash);
            followTheme();

            workspace.addChangeListener((event: Blockly.Events.Abstract) => {
                if (event.type === Blockly.Events.VAR_CREATE || event.type === Blockly.Events.VAR_DELETE || event.type === Blockly.Events.VAR_RENAME) {
                    setVariablesVersion((v) => v + 1);
                }
                if (loading || event.isUiEvent) return;
                clearTimeout(saveTimer);
                saveTimer = setTimeout(save, SAVE_DELAY_MS);
            });
            offRegistry = blocksApi.onRegistryChange(() => {
                refreshBlocks(schemas).then(markAway, fail("The blocks couldn't be updated"));
            });

            (async () => {
                const flows = await bridge.call<SavedFlows>(SERVICE_ACTIONS.load);
                await refreshBlocks(flows.schemas);
                if (closed) return;
                Blockly.serialization.workspaces.load(flows.workspace, workspace!);
                markAway();
            })().then(
                () => {
                    loading = false;
                },
                fail("Your flows couldn't be loaded"),
            );
            setReady(true);
        };
        // Blockly measures text as it draws, so it waits for the font
        loadBlockFonts().then(start, fail("The blocks couldn't be drawn"));

        /** Light or dark, as the app switches: Blockly takes colours, not variables, so the theme is made again. */
        const themeChanges = new MutationObserver(() => retheme());
        const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const retheme = () => {
            if (!workspace) return;
            try {
                workspace.setTheme(paperTheme());
            } catch (err) {
                fail("The blocks couldn't follow the theme")(err);
            }
        };
        const followTheme = () => {
            themeChanges.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-paperui-theme", "class"] });
            darkQuery.addEventListener("change", retheme);
        };

        onCleanup(() => {
            closed = true;
            themeChanges.disconnect();
            darkQuery.removeEventListener("change", retheme);
            clearTimeout(saveTimer);
            resize.disconnect();
            offState();
            offRegistry?.();
            workspace?.dispose();
            scratch.dispose();
        });
    });

    // the list follows the chosen category, project and search
    createEffect(() => {
        const contents = flyoutContents(groups());
        definitions();
        if (!ready() || !workspace) return;
        workspace.updateToolbox({ kind: "flyoutToolbox", contents } as unknown as Blockly.utils.toolbox.ToolboxDefinition);
        workspace.getFlyout()?.scrollToStart();
    });

    createEffect(() => {
        const hidden = collapsed();
        if (!ready() || !workspace) return;
        workspace.getFlyout()?.setVisible(!hidden);
        Blockly.svgResize(workspace);
    });

    /** The list starts where the header ends. */
    const headerRef = (el: HTMLDivElement) => {
        const observer = new ResizeObserver(() => {
            setLibraryTop(el.offsetHeight);
            workspace?.getFlyout()?.position();
        });
        observer.observe(el);
        onCleanup(() => observer.disconnect());
    };

    const zoom = (by: number) => workspace?.zoomCenter(by);
    const resetView = () => {
        if (!workspace) return;
        workspace.setScale(workspace.options.zoomOptions.startScale);
        workspace.scrollCenter();
    };

    const run = () => {
        for (const block of workspace?.getAllBlocks(false) ?? []) block.setWarningText(null, "run");
        bridge.call<number>(SERVICE_ACTIONS.run).then(() => setProblem(null), fail("Run didn't start"));
    };

    const choose = (id: string) => {
        setSelected(id);
        setSearch("");
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <div class={styles.topbar}>
                <PaperFlex direction="row" align="center" justify="space-between" gap="full" padding="half" background="surface" fullWidth>
                    <PaperFlex direction="row" align="center" gap="full" paddingX="half">
                        <Show when={state().running > 0}>
                            <PaperText preset="body">{state().running === 1 ? "1 flow running" : `${state().running} flows running`}</PaperText>
                        </Show>
                        <Show when={problem()}>
                            <PaperText preset="body" color="danger">
                                {problem()}
                            </PaperText>
                        </Show>
                    </PaperFlex>
                    <PaperFlex direction="row" align="center" gap="half" paddingX="half">
                        <PaperEffect variant="danger">
                            <PaperButton
                                variant="danger"
                                icon
                                disabled={state().running === 0}
                                onClick={() => bridge.call(SERVICE_ACTIONS.stop).catch(fail("Stop didn't work"))}
                                title="Stop every flow"
                                aria-label="Stop every flow"
                            >
                                <PaperIcon>stop</PaperIcon>
                            </PaperButton>
                        </PaperEffect>
                        <PaperEffect variant="success">
                            <PaperButton variant="success" icon onClick={run} title="Run the flows that start when Run is clicked" aria-label="Run">
                                <PaperIcon>play_arrow</PaperIcon>
                            </PaperButton>
                        </PaperEffect>
                    </PaperFlex>
                </PaperFlex>
            </div>
            <div class={styles.body}>
                <Show when={!collapsed()}>
                    <LibraryRail builtins={builtins()} panels={panels()} selected={selected()} onSelect={choose} />
                </Show>
                <div class={styles.stage}>
                    <div ref={host} class={styles.canvas} />
                    <Show
                        when={!collapsed()}
                        fallback={
                            <div class={styles.expand}>
                                <PaperButton onClick={() => setCollapsed(false)} title="Open the Library">
                                    <PaperIcon>menu_open</PaperIcon>
                                    Library
                                </PaperButton>
                            </div>
                        }
                    >
                        <LibraryHeader
                            category={category()}
                            selected={selected()}
                            search={search()}
                            onSearch={setSearch}
                            count={count()}
                            projects={shownPanel() ? projectsOf(shownPanel()!) : []}
                            project={shownProject()}
                            onProject={(id) => setChosenProjects((chosen) => ({ ...chosen, [shownPanel()!]: id }))}
                            sections={sectionNames()}
                            onJump={jump}
                            onCollapse={() => setCollapsed(true)}
                            headerRef={headerRef}
                        />
                    </Show>
                    <div class={styles.topRight}>
                        <Console entries={state().log} onClear={() => bridge.call(SERVICE_ACTIONS.clearLog).catch(fail("The log wasn't cleared"))} />
                    </div>
                    <div class={styles.bottomRight}>
                        <PaperFlex direction="column" gap="half">
                            <PaperButton variant="outline" icon onClick={() => zoom(1)} title="Zoom in" aria-label="Zoom in">
                                <PaperIcon>add</PaperIcon>
                            </PaperButton>
                            <PaperButton variant="outline" icon onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out">
                                <PaperIcon>remove</PaperIcon>
                            </PaperButton>
                            <PaperButton variant="outline" icon onClick={resetView} title="Reset the view" aria-label="Reset the view">
                                <PaperIcon>center_focus_strong</PaperIcon>
                            </PaperButton>
                        </PaperFlex>
                        <div
                            ref={trashTile}
                            class={styles.trash}
                            classList={{ [styles.trashDragging!]: trash().dragging, [styles.trashOver!]: trash().over }}
                            title="Drop a block here to delete it"
                        >
                            <PaperIcon>{trash().over ? "delete_forever" : "delete"}</PaperIcon>
                        </div>
                    </div>
                </div>
            </div>
            <BlocklyDialogs />
        </PaperFlex>
    );
}
