// The first-open tutorial a panel manifest declares: a few short pages the
// shell clicks through the first time someone opens the panel. One
// implementation of the rule: the daemon's manifest validator and the packer
// both call it, so a manifest that packs is a manifest the daemon lists.
//
//   "tutorial": [{ "icon": "terminal", "title": "Tabs stay open", "body": "..." }]

export const MAX_TUTORIAL_STEPS = 6;
export const MAX_TUTORIAL_TITLE_LENGTH = 80;
export const MAX_TUTORIAL_BODY_LENGTH = 400;

// a Material Symbols ligature name, the same vocabulary PaperIcon renders
const ICON_PATTERN = /^[a-z0-9_]{1,48}$/;

export interface TutorialStep {
    title: string;
    body: string;
    /** a Material Symbols name shown above the title */
    icon?: string;
}

/**
 * Returns the steps a panel manifest declares, or throws naming the first one
 * that breaks the rules. A missing field means no tutorial.
 */
export function validateTutorialDeclaration(raw: unknown): TutorialStep[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error("manifest tutorial must be an array");
    if (raw.length === 0 || raw.length > MAX_TUTORIAL_STEPS) {
        throw new Error(`a tutorial has 1 to ${MAX_TUTORIAL_STEPS} steps`);
    }
    return raw.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`tutorial step ${index} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.title !== "string" || !record.title.trim() || record.title.length > MAX_TUTORIAL_TITLE_LENGTH) {
            throw new Error(`tutorial step ${index} needs a title of at most ${MAX_TUTORIAL_TITLE_LENGTH} characters`);
        }
        if (typeof record.body !== "string" || !record.body.trim() || record.body.length > MAX_TUTORIAL_BODY_LENGTH) {
            throw new Error(`tutorial step ${index} needs a body of at most ${MAX_TUTORIAL_BODY_LENGTH} characters`);
        }
        const step: TutorialStep = { title: record.title.trim(), body: record.body.trim() };
        if (record.icon !== undefined) {
            if (typeof record.icon !== "string" || !ICON_PATTERN.test(record.icon)) {
                throw new Error(`tutorial step ${index} icon must be a Material Symbols name`);
            }
            step.icon = record.icon;
        }
        return step;
    });
}
