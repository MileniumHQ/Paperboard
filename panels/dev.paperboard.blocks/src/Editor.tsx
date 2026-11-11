// The Blocks editor for one project: a top bar with its name, menus, its
// switch, Stop and Run, then the Library (a rail of categories, and the
// chosen one's blocks in Blockly's flyout) and the canvas. Edits save as you
// make them; the service runs the flows.
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import * as Blockly from "blockly";
import { blocksApi, panelAssetUrl, panelsApi, type BlockInfo, type BlockProjectInfo, type PanelItem } from "@mileniumhq/paperapi";
import {
    PaperButton,
    PaperContextMenuItem,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperQuote,
    PaperSeparator,
    PaperToggle,
} from "@mileniumhq/paperui";
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
import { paperDropdowns } from "./lib/dropdownPlacement";
import { errorMessage } from "./lib/failure";
import type { SavedWorkspace } from "./lib/interpreter";
import { SERVICE_ACTIONS, type PanelState, type SavedFlows } from "./panel";
import { bridge, type Notice } from "./bridge";
import type { CanvasPreview, ProjectSummary } from "./lib/projects";
import type { ProjectsState } from "./projects/state";
import { DeleteProjectModal, ProjectNameField, RenameProjectModal } from "./projects/ProjectDialogs";
import { createFileActions } from "./FileActions";
import { BlocklyDialogs } from "./BlocklyDialogs";
import { LibraryHeader, LibraryRail, type LibraryCategory } from "./Library";
import styles from "./Editor.module.css";

const SAVE_DELAY_MS = 400;
/** the notice a failed save leaves, cleared by the next save that works */
const NOT_SAVED = "Your changes weren't saved";

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

/** Where each stack sits on the canvas, for the project's card. */
function canvasPreview(workspace: Blockly.WorkspaceSvg): CanvasPreview | null {
    const rects = workspace.getTopBlocks(false).map((block) => {
        const r = block.getBoundingRectangle();
        return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
    });
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    return { bounds: { x: left, y: top, w: right - left, h: bottom - top }, rects };
}

export default function Editor(props: {
    projectId: string;
    project: () => ProjectSummary;
    projects: ProjectsState;
    onHome: () => void;
    onOpen: (project: ProjectSummary) => void;
}) {
    let host!: HTMLDivElement;
    let trashTile!: HTMLDivElement;
    const [trash, setTrash] = createSignal<TrashState>({ dragging: false, over: false });
    let workspace: Blockly.WorkspaceSvg | undefined;
    const [state, setState] = createSignal<PanelState>(bridge.getState());
    const [notice, setNotice] = createSignal<Notice | null>(null);
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
    // the save in flight, so leaving waits for it
    let saving: Promise<void> = Promise.resolve();
    // the newest log line already pointed at on the canvas
    let shownLogId = 0;

    const fail = (title: string) => (err: unknown) => setNotice({ kind: "failed", title, text: errorMessage(err) });
    const project = props.projectId;
    const running = () => state().running[project] ?? 0;
    const log = createMemo(() => state().log.filter((entry) => entry.project === project));

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
            if (builtin.custom === "VARIABLE") {
                // its "Create variable" button is the header's PaperButton, not Blockly's
                if (!ready() || !workspace) return [];
                const contents = Blockly.Variables.flyoutCategory(workspace) as unknown as Json[];
                return [{ blocks: contents.filter((item) => item.kind !== "button") }];
            }
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
                    setNotice({ kind: "failed", title: `${panelList.find((p) => p.id === source.panelId)?.name ?? source.panelId}'s choices didn't load`, text: errorMessage(err) }),
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

    /** The canvas as it is now, with the schemas of the blocks on it. */
    function snapshot(): SavedFlows {
        const saved = Blockly.serialization.workspaces.save(workspace!) as SavedWorkspace;
        const used = new Set(workspace!.getAllBlocks(false).map((b) => b.type));
        return { workspace: saved, schemas: Object.fromEntries(Object.entries(schemas).filter(([type]) => used.has(type))) };
    }

    /** Saves the canvas now; rejects with why it didn't save. */
    function saveNow(): Promise<void> {
        clearTimeout(saveTimer);
        if (!workspace || loading) return saving;
        const flows = snapshot();
        const preview = canvasPreview(workspace);
        saving = saving.catch(() => undefined).then(() => bridge.call(SERVICE_ACTIONS.save, { project, flows, preview })).then(() => {
            setNotice((shown) => (shown?.title === NOT_SAVED ? null : shown));
        });
        return saving;
    }

    const save = () => void saveNow().catch(fail(NOT_SAVED));

    /** Saves the latest edits now, saying why when they didn't save. */
    const flush = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
        try {
            await saveNow();
            return { ok: true };
        } catch (err) {
            return { ok: false, message: errorMessage(err) };
        }
    };

    /** Shows the flows the service has now: after a backup is loaded, say. */
    async function reload(): Promise<void> {
        if (!workspace) throw new Error("The canvas isn't drawn yet");
        loading = true;
        try {
            const flows = await bridge.call<SavedFlows>(SERVICE_ACTIONS.load, { project });
            await refreshBlocks(flows.schemas);
            Blockly.serialization.workspaces.load(flows.workspace, workspace);
            markAway();
        } finally {
            loading = false;
        }
    }

    function showErrors(next: PanelState): void {
        if (!workspace) return;
        for (const entry of next.log) {
            if (entry.id <= shownLogId) continue;
            if (entry.project === project && entry.level === "error" && entry.blockId) workspace.getBlockById(entry.blockId)?.setWarningText(entry.message, "run");
        }
        shownLogId = next.log.at(-1)?.id ?? shownLogId;
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
        registerChoicesField({ fetch: (s) => blocksApi.choices(s.panelId, s.entry, s.input), report: (text) => setNotice({ kind: "failed", title: "Choices didn't load", text }) });
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
            paperDropdowns();
            workspace = Blockly.inject(host, {
                renderer: PAPER_RENDERER,
                theme: paperTheme(),
                toolbox: { kind: "flyoutToolbox", contents: [] },
                plugins: { flyoutsVerticalToolbox: LIBRARY_FLYOUT },
                media: "./blockly-media/",
                // the trash and zoom are PaperUI's, over the canvas (below)
                trashcan: false,
                zoom: { controls: false, wheel: true, startScale: 1 },
                // Actions' dots: one at every double gap, drawn by Editor.module.css
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
                const flows = await bridge.call<SavedFlows>(SERVICE_ACTIONS.load, { project });
                await refreshBlocks(flows.schemas);
                if (closed) return;
                Blockly.serialization.workspaces.load(flows.workspace, workspace!);
                markAway();
                // the log lines from before this window opened are already on the blocks they name
                showErrors(state());
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
        // Run starts what is saved, so the latest edits go first
        saveNow()
            .then(() => bridge.call<number>(SERVICE_ACTIONS.run, { project }))
            .catch(fail("Run didn't start"));
    };

    // the project changes the menus make, each reporting what failed
    const [working, setWorking] = createSignal(false);
    const change = async (failed: string, work: () => Promise<void>) => {
        if (working()) return;
        setWorking(true);
        try {
            await work();
        } catch (err) {
            fail(failed)(err);
        } finally {
            setWorking(false);
        }
    };
    // a new project left without a block is not kept: its last edit is saved
    // first, so the service sees whether it has one by now
    const leaveDraft = async () => {
        if (!props.project().draft) return;
        const saved = await flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved: ${saved.message}`);
        await props.projects.discardDraft(project);
    };
    const leave = async () => {
        // the latest edits are saved before the canvas goes
        const saved = await flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved: ${saved.message}`);
        await leaveDraft();
    };
    const newProject = () =>
        change("Project not made", async () => {
            const made = await props.projects.create();
            await leave();
            props.onOpen(made);
        });
    const copyProject = () =>
        change("Project not copied", async () => {
            // the copy is of what was saved, so the latest edits go first
            const saved = await flush();
            if (!saved.ok) throw new Error(`Your latest changes are not saved, so the copy would miss them: ${saved.message}`);
            const copy = await props.projects.duplicate(project);
            await leaveDraft();
            props.onOpen(copy);
        });
    const goHome = () =>
        change("Project not closed", async () => {
            await leave();
            props.onHome();
        });
    // the switch flips on its own, never waiting on another change
    const setEnabled = (enabled: boolean) => props.projects.setEnabled(project, enabled).catch(fail(enabled ? "Flows not turned on" : "Flows not turned off"));
    const [renaming, setRenaming] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);

    const file = createFileActions({
        name: () => props.project().name,
        loaded: () => ready() && !loading,
        snapshot: () => snapshot(),
        add: (flows) => addFlows(flows),
        flush,
        reload,
        onNotice: setNotice,
    });

    /** A file's flows, added below what the canvas holds, and saved. */
    async function addFlows(flows: SavedFlows): Promise<void> {
        if (!workspace) throw new Error("The canvas isn't drawn yet");
        // the file's blocks take their shape from its schemas where their panel is away
        await refreshBlocks({ ...flows.schemas, ...schemas });
        const below = workspace.getTopBlocks(false).reduce((y, b) => Math.max(y, b.getBoundingRectangle().bottom), -Infinity);
        const fileTop = Math.min(...(flows.workspace.blocks?.blocks ?? []).map((b) => b.y ?? 0));
        const shift = Number.isFinite(below) && Number.isFinite(fileTop) ? below + uiGap() * 4 - fileTop : 0;
        Blockly.Events.setGroup(true);
        try {
            for (const variable of flows.workspace.variables ?? []) {
                if (!workspace.getVariableMap().getVariableById(variable.id) && !workspace.getVariableMap().getVariable(variable.name, variable.type ?? "")) {
                    workspace.getVariableMap().createVariable(variable.name, variable.type ?? "", variable.id);
                }
            }
            for (const block of flows.workspace.blocks?.blocks ?? []) {
                Blockly.serialization.blocks.append({ ...block, y: (block.y ?? 0) + shift } as Blockly.serialization.blocks.State, workspace);
            }
        } finally {
            Blockly.Events.setGroup(false);
        }
        markAway();
        await saveNow();
    }

    const choose = (id: string) => {
        setSelected(id);
        setSearch("");
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <div class={styles.topbar}>
                <PaperFlex direction="row" align="center" gap="half" padding="half" background="surface" fullWidth>
                    <PaperButton icon variant="text" title="All projects" aria-label="All projects" disabled={working()} onClick={() => void goHome()}>
                        <PaperIcon>arrow_back</PaperIcon>
                    </PaperButton>
                    <PaperFlex direction="column" align="flex-start" gap="onefourth">
                        <ProjectNameField
                            name={props.project().name}
                            onRename={(name) => props.projects.rename(project, name)}
                            onFailed={(text) => setNotice({ kind: "failed", title: "Not renamed", text })}
                        />
                        <PaperMenuBar aria-label={props.project().name}>
                            <PaperMenuBarMenu label="Project" size="tiny">
                                <PaperContextMenuItem icon="add" disabled={working()} onClick={() => void newProject()}>
                                    New project
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="file_copy" disabled={working() || !ready()} onClick={() => void copyProject()}>
                                    Make a copy
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="edit" onClick={() => setRenaming(true)}>
                                    Rename
                                </PaperContextMenuItem>
                                <PaperSeparator role="separator" />
                                <PaperContextMenuItem icon="delete" danger onClick={() => setDeleting(true)}>
                                    Delete
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                            <PaperMenuBarMenu label="File" size="tiny">
                                <PaperContextMenuItem icon="file_export" disabled={file.busy() || !ready()} onClick={() => void file.exportFlows()}>
                                    Export
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="file_open" disabled={file.busy() || !ready()} onClick={() => void file.importFlows()}>
                                    Import
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                            <PaperMenuBarMenu label="Backup" size="tiny">
                                <PaperContextMenuItem icon="backup" disabled={file.busy()} onClick={() => void file.createBackup()}>
                                    Create backup
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="settings_backup_restore" disabled={file.busy()} onClick={() => void file.openLoad()}>
                                    Load backup
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                        </PaperMenuBar>
                    </PaperFlex>
                    <PaperFlex direction="row" align="center" justify="flex-end" gap="full" paddingX="half" fullWidth>
                        <PaperToggle
                            checked={props.project().enabled}
                            aria-label="Flows start on their events"
                            title="When off, this project's flows don't start on their events"
                            onChange={(enabled) => void setEnabled(enabled)}
                        />
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperEffect variant="danger">
                                <PaperButton
                                    variant="danger"
                                    icon
                                    disabled={running() === 0}
                                    onClick={() => bridge.call(SERVICE_ACTIONS.stop, { project }).catch(fail("Stop didn't work"))}
                                    title={running() === 1 ? "Stop the flow running now" : `Stop the ${running()} flows running now`}
                                    aria-label="Stop"
                                >
                                    <PaperIcon>stop</PaperIcon>
                                </PaperButton>
                            </PaperEffect>
                            <PaperEffect variant="success">
                                <PaperButton variant="success" icon disabled={!ready()} onClick={run} title="Run the flows that start when Run is clicked" aria-label="Run">
                                    <PaperIcon>play_arrow</PaperIcon>
                                </PaperButton>
                            </PaperEffect>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </div>
            <file.LoadBackupModal />
            <RenameProjectModal project={renaming() ? props.project() : null} onRename={props.projects.rename} onClose={() => setRenaming(false)} />
            <DeleteProjectModal
                project={deleting() ? props.project() : null}
                onDelete={async (id) => {
                    await props.projects.remove(id);
                    props.onHome();
                }}
                onClose={() => setDeleting(false)}
            />
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
                            onCreateVariable={BUILTIN_SECTIONS.find((s) => builtinId(s.name) === selected())?.custom === "VARIABLE" && workspace ? () => Blockly.Variables.createVariableButtonHandler(workspace!) : undefined}
                            headerRef={headerRef}
                        />
                    </Show>
                    <div class={styles.topRight}>
                        <Show when={notice()}>
                            {(shown) => (
                                <PaperQuote
                                    variant={shown().kind === "failed" ? "danger" : "success"}
                                    icon={shown().kind === "failed" ? "warning" : "check_circle"}
                                    title={shown().title}
                                    role={shown().kind === "failed" ? "alert" : "status"}
                                    onDismiss={() => setNotice(null)}
                                >
                                    {shown().text}
                                </PaperQuote>
                            )}
                        </Show>
                        <Console entries={log()} onClear={() => bridge.call(SERVICE_ACTIONS.clearLog, { project }).catch(fail("The log wasn't cleared"))} />
                    </div>
                    <div class={styles.bottomRight}>
                        <PaperFlex direction="column" gap="half">
                            <PaperButton variant="primary" icon onClick={() => zoom(1)} title="Zoom in" aria-label="Zoom in">
                                <PaperIcon>add</PaperIcon>
                            </PaperButton>
                            <PaperButton variant="primary" icon onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out">
                                <PaperIcon>remove</PaperIcon>
                            </PaperButton>
                            <PaperButton variant="primary" icon onClick={resetView} title="Reset the view" aria-label="Reset the view">
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
