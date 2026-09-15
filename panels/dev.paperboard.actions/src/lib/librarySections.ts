// Pure grouping for the Actions library: a panel's triggers and actions are
// grouped by the category their schema declares. Panels can attach an icon
// and sort order to a category through PaperAPI's declared-category array;
// without an order, categories sort alphabetically.
import type { ActionInfo, TriggerInfo } from "@paperboard-dev/paperapi";

export interface LibrarySection {
    /** stable key: the category name */
    id: string;
    name: string;
    icon?: string;
    order?: number;
    triggers: TriggerInfo[];
    actions: ActionInfo[];
}

export const UNCATEGORIZED_SECTION = "General";

interface SectionMeta {
    name: string;
    icon?: string;
    order?: number;
}

function sectionMetaOf(
    category:
        | string
        | { name?: string; icon?: string; order?: number }
        | undefined,
): SectionMeta {
    if (!category) return { name: UNCATEGORIZED_SECTION };
    if (typeof category === "string") {
        return { name: category.trim() || UNCATEGORIZED_SECTION };
    }
    return {
        name: category.name?.trim() || UNCATEGORIZED_SECTION,
        icon: category.icon,
        order: typeof category.order === "number" ? category.order : undefined,
    };
}

export function buildLibrarySections(
    triggers: TriggerInfo[],
    actions: ActionInfo[],
): LibrarySection[] {
    const sections = new Map<string, LibrarySection>();
    const ensure = (meta: SectionMeta): LibrarySection => {
        let section = sections.get(meta.name);
        if (!section) {
            section = {
                id: meta.name,
                name: meta.name,
                icon: meta.icon,
                order: meta.order,
                triggers: [],
                actions: [],
            };
            sections.set(meta.name, section);
        } else {
            // first declaration wins; later items only name the category
            section.icon ??= meta.icon;
            section.order ??= meta.order;
        }
        return section;
    };
    for (const trigger of triggers) {
        ensure(sectionMetaOf(trigger.schema?.category)).triggers.push(trigger);
    }
    for (const action of actions) {
        ensure(sectionMetaOf(action.schema?.category)).actions.push(action);
    }
    return [...sections.values()].sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return a.name.localeCompare(b.name);
    });
}
