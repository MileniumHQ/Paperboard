import { BUILTIN_CATEGORY_META, type BuiltinCategory, type BuiltinDef } from "./types";
import { timingBuiltins } from "./timing";
import { controlBuiltins } from "./control";
import { variablesBuiltins } from "./variables";
import { dataBuiltins } from "./data";
import { mathBuiltins } from "./math";
import { conditionBuiltins } from "./condition";
import { datetimeBuiltins } from "./datetime";
import { webBuiltins } from "./web";
import { textBuiltins } from "./text";
import { utilityBuiltins } from "./utility";

export * from "./types";

export const BUILTIN_DEFS: BuiltinDef[] = [
    ...timingBuiltins,
    ...controlBuiltins,
    ...variablesBuiltins,
    ...dataBuiltins,
    ...mathBuiltins,
    ...conditionBuiltins,
    ...datetimeBuiltins,
    ...webBuiltins,
    ...textBuiltins,
    ...utilityBuiltins,
];

export const BUILTIN_CATEGORIES: BuiltinCategory[] = BUILTIN_CATEGORY_META.map((meta) => ({
    ...meta,
    items: BUILTIN_DEFS.filter((d) => d.category === meta.id).map((d) => d.item),
}));

// Registry-shaped entries for the stored-block schema merge: a flow saved
// before a builtin gained metadata (like the Text action's multiline field)
// picks the current schema up on load instead of keeping a stale one.
export const BUILTIN_SCHEMA_ENTRIES = BUILTIN_DEFS.flatMap((def) =>
    def.item.schema
        ? [{ panelId: def.item.panelId, action: def.item.action, schema: def.item.schema }]
        : [],
);
