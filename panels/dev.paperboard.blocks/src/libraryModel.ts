// What the Library shows: the categories in its rail (the built-ins, then
// each panel that offers blocks), the chosen one's blocks under their
// headings, or every block a search finds, and a panel's projects to choose
// from. Library.tsx draws the rail and header; the list is Blockly's flyout.
import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import * as Blockly from "blockly";
import { panelAssetUrl, type BlockProjectInfo } from "@mileniumhq/paperapi";
import { BUILTIN_SECTIONS, PROPERTIES_CATEGORY, type Definitions } from "./lib/blockDefs";
import { NO_PANEL_ICON, NO_PROJECT_ICON, type BlockIcon } from "./lib/blockStyles";
import { HEADING_KIND, type HeadingInfo } from "./lib/libraryHeading";
import { uiGap } from "./lib/libraryFlyout";
import { sortVariableReads } from "./lib/naturalOrder";
import type { Registry } from "./editorFlows";
import type { LibraryCategory, LibraryProject } from "./Library";

type Json = Record<string, unknown>;

/** How long typing in the search pauses before the list is searched. */
const SEARCH_PAUSE_MS = 250;
/** What a category heading shows when its panel declared no symbol for it. */
const CATEGORY_SYMBOL = "category";
const PROPERTIES_SYMBOL = "tune";

const builtinId = (name: string) => `builtin:${name}`;
const panelCategoryId = (id: string) => `panel:${id}`;

/** A run of the list under one heading. */
interface Group {
    label?: string;
    icon?: HeadingInfo["icon"];
    blocks: Json[];
}

/** A rail item or project as the Library draws it: its picture, or its symbol. */
const pictured = <T extends { id: string; name: string }>(item: T, icon: BlockIcon) => ({ ...item, ...("src" in icon ? { iconUrl: icon.src } : { icon: icon.symbol }) });

/** Keeps each item's previous object while it reads the same, so a refresh doesn't rebuild its row and reload its icon. */
function kept<T extends LibraryCategory | LibraryProject>(previous: T[], next: T[]): T[] {
    return next.map((item) => {
        const old = previous.find((p) => p.id === item.id);
        return old && old.name === item.name && old.icon === item.icon && old.iconUrl === item.iconUrl ? old : item;
    });
}

export function createLibraryModel(options: {
    workspace: () => Blockly.WorkspaceSvg | undefined;
    /** the canvas is drawn */
    ready: () => boolean;
    headingClasses: HeadingInfo["classes"];
}) {
    const [registry, setRegistry] = createSignal<Registry>({ panels: [], projects: [], sections: [] });
    // bumped each time the blocks are (re)defined, so the list draws them anew
    const [definitions, setDefinitions] = createSignal(0);
    const [selected, setSelected] = createSignal(builtinId(BUILTIN_SECTIONS[0]!.name));
    const [chosenProjects, setChosenProjects] = createSignal<Record<string, string>>({});
    const [search, setSearch] = createSignal("");
    // what the list is searched for: the search once typing pauses, so each
    // letter doesn't draw a list the next one replaces (a first letter can
    // match a hundred blocks, a long wait on a slow computer)
    const [query, setQuery] = createSignal("");
    let queryTimer: ReturnType<typeof setTimeout> | undefined;
    const typeSearch = (text: string) => {
        setSearch(text);
        clearTimeout(queryTimer);
        if (!text.trim()) setQuery("");
        else queryTimer = setTimeout(() => setQuery(text), SEARCH_PAUSE_MS);
    };
    // a variable made, renamed or removed changes the Variables list
    const [variablesVersion, setVariablesVersion] = createSignal(0);
    // the workspace's functions, names and parameters: Functions lists a call block for each
    const [functionsShape, setFunctionsShape] = createSignal("");
    // each toolbox block's text as it reads, for search: by the block itself,
    // since Blockly writes to a toolbox block's JSON once it shows it
    const blockText = new WeakMap<Json, string>();
    const scratch = new Blockly.Workspace();
    onCleanup(() => {
        clearTimeout(queryTimer);
        scratch.dispose();
    });

    const panelName = (id: string) => registry().panels.find((p) => p.id === id)?.name ?? id;
    /** A panel's icon as the app shows it: the image it declares, or the symbol the sidebar shows when it has none. */
    const panelIcon = (id: string): BlockIcon => {
        const found = registry().panels.find((p) => p.id === id);
        if (found?.iconUrl) return { src: found.iconUrl };
        return found?.icon ? { src: panelAssetUrl(id, found.icon) } : { symbol: NO_PANEL_ICON };
    };
    /** A project's picture as its panel gave it (a file in the panel's folder, or a data URL), else its symbol. */
    const projectIcon = (p: BlockProjectInfo): BlockIcon => {
        if (p.image) return { src: p.image.startsWith("data:") ? p.image : panelAssetUrl(p.panelId, p.image) };
        return { symbol: p.icon ?? NO_PROJECT_ICON };
    };
    const projectOf = (panel: string, project: string) => registry().projects.find((p) => p.panelId === panel && p.id === project);

    const builtins: LibraryCategory[] = BUILTIN_SECTIONS.map((s) => ({ id: builtinId(s.name), name: s.name, icon: s.icon }));
    const panels = createMemo<LibraryCategory[]>(
        (previous) =>
            kept(
                previous,
                [...new Set(registry().sections.map((s) => s.panelId))].map((id) => pictured({ id: panelCategoryId(id), name: panelName(id) }, panelIcon(id))),
            ).sort((a, b) => a.name.localeCompare(b.name)),
        [],
    );
    const category = createMemo(() => [...builtins, ...panels()].find((c) => c.id === selected()));
    const builtin = createMemo(() => BUILTIN_SECTIONS.find((s) => builtinId(s.name) === selected()));

    const shownPanel = createMemo(() => (selected().startsWith("panel:") ? selected().slice("panel:".length) : null));
    const projectsOf = (id: string) => registry().projects.filter((p) => p.panelId === id && registry().sections.some((s) => s.panelId === id && s.project === p.id));
    // the shown panel's projects, each keeping its object while it reads the same
    const projects = createMemo<LibraryProject[]>((previous) => {
        const id = shownPanel();
        return id ? kept(previous, projectsOf(id).map((p) => pictured({ id: p.id, name: p.name }, projectIcon(p)))) : [];
    }, []);
    const shownProject = createMemo(() => {
        const id = shownPanel();
        if (!id) return null;
        const offered = projectsOf(id);
        return offered.find((p) => p.id === chosenProjects()[id])?.id ?? offered[0]?.id ?? null;
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
            const symbol = s.category === PROPERTIES_CATEGORY ? PROPERTIES_SYMBOL : (s.categoryIcon ?? CATEGORY_SYMBOL);
            if (same) {
                same.blocks = [...same.blocks, ...s.contents];
                // a project's section may know the symbol its panel's section of that name lacked
                if (s.categoryIcon && same.icon && "symbol" in same.icon && same.icon.symbol === CATEGORY_SYMBOL) same.icon = { symbol: s.categoryIcon };
            } else groups.push({ ...(s.category ? { label: s.category, icon: { symbol } } : {}), blocks: s.contents });
        }
        return groups;
    };

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

    /** What the list shows now: the category's blocks, or every block the search finds. */
    const groups = createMemo<Group[]>(() => {
        const words = query().trim().toLowerCase();
        if (words) {
            const all: Group[] = [
                ...BUILTIN_SECTIONS.filter((s) => !s.custom).map((s) => ({ label: s.name, icon: { symbol: s.icon }, blocks: s.contents })),
                ...registry().sections.map((s) => {
                    const project = s.project ? projectOf(s.panelId, s.project) : undefined;
                    return {
                        // a project's blocks show the project, as its panel shows it
                        icon: project ? projectIcon(project) : panelIcon(s.panelId),
                        // a category named for its panel isn't said twice
                        label: [panelName(s.panelId), s.project ? (project?.name ?? s.project) : null, s.category === panelName(s.panelId) ? null : s.category].filter(Boolean).join(" · "),
                        blocks: s.contents,
                    };
                }),
            ];
            return all.map((g) => ({ ...g, blocks: g.blocks.filter((b) => b.kind === "block" && textOf(b).includes(words)) })).filter((g) => g.blocks.length);
        }
        const shown = builtin();
        if (shown) {
            const workspace = options.workspace();
            if (shown.custom === "VARIABLE") {
                variablesVersion();
                // its "Create variable" button is the header's PaperButton, not Blockly's
                if (!options.ready() || !workspace) return [];
                const contents = Blockly.Variables.flyoutCategory(workspace) as unknown as Json[];
                // in the order a person counts: variable_2 comes before variable_10
                return [{ blocks: sortVariableReads(contents.filter((item) => item.kind !== "button"), (id) => workspace.getVariableMap().getVariableById(id)?.getName() ?? id) }];
            }
            if (shown.custom === "PROCEDURE") {
                functionsShape();
                // a function is made by dragging out "to do something" and naming it
                if (!options.ready() || !workspace) return [];
                return [{ blocks: Blockly.Procedures.flyoutCategory(workspace) as unknown as Json[] }];
            }
            return [{ blocks: shown.contents }];
        }
        const id = shownPanel();
        return id ? panelGroups(id, shownProject()) : [];
    });

    /** The list as Blockly's flyout takes it: each group's heading, then its blocks. */
    const flyout = createMemo(() =>
        // a heading after blocks gets more room above it than a block does
        groups().flatMap((g, i) => {
            if (!g.label) return g.blocks;
            const heading: HeadingInfo = {
                kind: HEADING_KIND,
                text: g.label,
                icon: g.icon ?? { symbol: CATEGORY_SYMBOL },
                count: g.blocks.filter((b) => b.kind === "block").length,
                classes: options.headingClasses,
            };
            return [...(i > 0 ? [{ kind: "sep", gap: uiGap() * 2 }] : []), heading as unknown as Json, ...g.blocks];
        }),
    );

    const count = createMemo(() => groups().reduce((n, g) => n + g.blocks.filter((b) => b.kind === "block").length, 0));
    const sectionNames = createMemo(() => groups().flatMap((g) => (g.label ? [g.label] : [])));

    return {
        /** the registry was read again: the blocks are defined anew */
        setRegistry: (next: Registry) =>
            batch(() => {
                setRegistry(next);
                setDefinitions((n) => n + 1);
            }),
        definitions,
        variablesChanged: () => setVariablesVersion((v) => v + 1),
        setFunctionsShape,
        panelIcon,
        builtins,
        panels,
        category,
        selected,
        /** a category from the rail: the search starts again */
        choose: (id: string) => {
            setSelected(id);
            typeSearch("");
        },
        /** the Variables category is shown, which makes variables */
        showsVariables: () => builtin()?.custom === "VARIABLE",
        search,
        query,
        typeSearch,
        projects,
        shownProject,
        chooseProject: (id: string) => {
            const panel = shownPanel();
            if (!panel) throw new Error("No panel is shown to choose a project of");
            setChosenProjects((chosen) => ({ ...chosen, [panel]: id }));
        },
        flyout,
        count,
        sectionNames,
    };
}
