// What the Library offers: the registry's actions grouped into one category
// per panel beside the builtin ones, and a search across all of them.
import type { ActionInfo, ActionSchema } from "@mileniumhq/paperapi";
import type { BuiltinCategory } from "./builtins";
import { ACTIONS_PANEL_ID } from "../panelId";
import { buildLibrarySections, type LibrarySection } from "./librarySections";

export interface PanelCategory {
    id: string;
    domain: "panel";
    name: string;
    icon: string;
    iconUrl?: string;
    triggers: ActionInfo[];
    actions: ActionInfo[];
    sections: LibrarySection[];
}

export type Category = BuiltinCategory | PanelCategory;

export interface LibraryEntry {
    data: ActionInfo;
    isTrigger: boolean;
    iconUrl?: string;
}

export interface SearchGroup {
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
): PanelCategory[] {
    const map = new Map<string, PanelCategory>();

    for (const act of registered) {
        if (act.action.startsWith("call-function-")) continue;
        // own sync/test actions run via api, never placeable blocks
        if (act.panelId === ACTIONS_PANEL_ID) continue;
        // declared internal: callable, never offered as a block
        if (act.schema?.internal === true) continue;

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
                sections: [],
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

    const categories = Array.from(map.values());
    for (const category of categories) {
        category.sections = buildLibrarySections(category.triggers, category.actions);
    }
    return categories;
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
        const matched: LibraryEntry[] = [];
        if (cat.domain === "panel") {
            for (const trig of cat.triggers) {
                if (matches(trig, query)) matched.push({ data: trig, isTrigger: true, iconUrl: cat.iconUrl });
            }
            for (const act of cat.actions) {
                if (matches(act, query)) matched.push({ data: act, isTrigger: false, iconUrl: cat.iconUrl });
            }
        } else {
            for (const item of cat.items) {
                if (matches(item, query)) matched.push({ data: item, isTrigger: isBuiltinTrigger(item), iconUrl: undefined });
            }
        }

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
