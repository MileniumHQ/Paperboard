// What the Library offers: the registry's actions grouped into one category
// per panel beside the builtin ones, and a search across all of them.
// A panel that keeps its actions in projects (a server each, a bot each)
// shows its global actions and one project's at a time; a block in one
// project is a different block from the same-named one in another.
import type { ActionInfo, ActionSchema, ProjectInfo } from "@mileniumhq/paperapi";
import type { BuiltinCategory } from "./builtins";
import { ACTIONS_PANEL_ID } from "../panelId";
import { buildLibrarySections, isLibraryVisible, type LibrarySection } from "./librarySections";

export interface PanelCategory {
    id: string;
    domain: "panel";
    name: string;
    icon: string;
    iconUrl?: string;
    /** every offered event and action, global and in every project */
    triggers: ActionInfo[];
    actions: ActionInfo[];
    /** the panel's projects, by name; empty for a panel without any */
    projects: ProjectInfo[];
}

export type Category = BuiltinCategory | PanelCategory;

export interface LibraryEntry {
    data: ActionInfo;
    isTrigger: boolean;
    iconUrl?: string;
}

export interface SearchGroup {
    /** the panel's name, then the project's for that project's blocks */
    categoryName: string;
    categoryIcon: string;
    categoryIconUrl?: string;
    items: LibraryEntry[];
}

const titleCase = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// a builtin is a trigger when it only listens, or says so itself
export function isBuiltinTrigger(item: ActionInfo): boolean {
    return Boolean((item.schema as any)?.eventOnly || (item as any).isTrigger);
}

export function panelCategoriesFrom(
    registered: ActionInfo[],
    panelInfo: (panelId: string) => { name: string; iconUrl: string },
    projects: ProjectInfo[],
): PanelCategory[] {
    const map = new Map<string, PanelCategory>();
    const projectKey = (panelId: string, id: string) => `${panelId}\u0000${id}`;
    const known = new Set(projects.map((p) => projectKey(p.panelId, p.id)));

    for (const act of registered) {
        if (act.action.startsWith("call-function-")) continue;
        // own sync/test actions run via api, never placeable blocks
        if (act.panelId === ACTIONS_PANEL_ID) continue;
        // internal, hidden or deprecated: callable, never offered as a block
        if (!isLibraryVisible(act)) continue;
        // a project's actions arrive with it; one not listed yet is skipped
        // until the registry update that announces it
        if (act.project && !known.has(projectKey(act.panelId, act.project))) continue;

        const schema: ActionSchema = act.schema || {
            id: act.action,
            name: titleCase(act.action),
            description: "",
            template: titleCase(act.action),
        };

        let cat = map.get(act.panelId);
        if (!cat) {
            const info = panelInfo(act.panelId);
            cat = {
                id: act.panelId,
                domain: "panel",
                name: info.name,
                icon: "extension",
                iconUrl: info.iconUrl,
                triggers: [],
                actions: [],
                projects: [],
            };
            map.set(act.panelId, cat);
        }
        // listen-only actions stay in the triggers lane; dual actions
        // (run + event) stay in the actions lane and can nest in flows
        if (schema.eventOnly === true) {
            cat.triggers.push({ ...act, schema });
        } else {
            cat.actions.push({ ...act, schema });
        }
    }

    for (const project of projects) map.get(project.panelId)?.projects.push(project);
    const categories = Array.from(map.values());
    for (const category of categories) category.projects.sort((a, b) => a.name.localeCompare(b.name));
    return categories;
}

/** The project a panel's Library shows: the one chosen, while it exists, or
 *  the first. Null for a panel without projects. */
export function shownProject(category: PanelCategory, chosen: string | undefined): ProjectInfo | null {
    return category.projects.find((p) => p.id === chosen) ?? category.projects[0] ?? null;
}

/** What a panel's Library shows: its global blocks and the shown project's,
 *  in the sections their schemas declare. */
export function categorySections(category: PanelCategory, project: string | null): LibrarySection[] {
    const shown = (item: ActionInfo) => !item.project || item.project === project;
    return buildLibrarySections(category.triggers.filter(shown), category.actions.filter(shown));
}

// an entry matches on its name, description or template
function matches(item: ActionInfo, query: string): boolean {
    const name = item.schema?.name || item.action || "";
    const desc = item.schema?.description || "";
    const template = item.schema?.template || "";
    return (
        name.toLowerCase().includes(query) ||
        desc.toLowerCase().includes(query) ||
        template.toLowerCase().includes(query)
    );
}

export function searchLibrary(categories: Category[], search: string): SearchGroup[] {
    const query = search.toLowerCase().trim();
    if (!query) return [];

    const results: SearchGroup[] = [];
    for (const cat of categories) {
        if (cat.domain === "panel") {
            // the global blocks, then each project's under its own name
            for (const project of [null, ...cat.projects]) {
                const mine = (item: ActionInfo) => (item.project ?? null) === (project?.id ?? null) && matches(item, query);
                const matched: LibraryEntry[] = [
                    ...cat.triggers.filter(mine).map((data) => ({ data, isTrigger: true, iconUrl: cat.iconUrl })),
                    ...cat.actions.filter(mine).map((data) => ({ data, isTrigger: false, iconUrl: cat.iconUrl })),
                ];
                if (matched.length > 0) {
                    results.push({
                        categoryName: project ? `${cat.name} · ${project.name}` : cat.name,
                        categoryIcon: cat.icon,
                        categoryIconUrl: cat.iconUrl,
                        items: matched,
                    });
                }
            }
            continue;
        }
        const matched: LibraryEntry[] = cat.items
            .filter((item) => matches(item, query))
            .map((item) => ({ data: item, isTrigger: isBuiltinTrigger(item), iconUrl: undefined }));
        if (matched.length > 0) {
            results.push({
                categoryName: cat.name,
                categoryIcon: cat.icon,
                categoryIconUrl: cat.iconUrl,
                items: matched,
            });
        }
    }
    return results;
}
