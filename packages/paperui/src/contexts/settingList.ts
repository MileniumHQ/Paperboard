import { createContext, useContext } from "solid-js";

/**
 * Set by PaperSettingList. A named control inside reads its value from the
 * list's record, so `value` and `defaultValue` on the list fill the controls.
 */
export interface PaperSettingListContextValue {
    /** the record's value for a control name; undefined when it has none */
    valueOf: (name: string) => unknown;
}

export const PaperSettingListContext = createContext<PaperSettingListContextValue>();

/**
 * The value the enclosing PaperSettingList's record holds for a control
 * name. Undefined outside a list, without a name, or when the record has no
 * value (undefined or null) for it.
 */
export function useSettingListValue(name: () => string | undefined): () => unknown {
    const list = useContext(PaperSettingListContext);
    return () => {
        const key = name();
        if (!list || !key) return undefined;
        return list.valueOf(key) ?? undefined;
    };
}

/** A checkbox-like control's state from the record: a boolean or nothing. */
export function useSettingListChecked(
    name: () => string | undefined,
    control: string,
): () => boolean | undefined {
    const value = useSettingListValue(name);
    return () => {
        const v = value();
        if (v === undefined || typeof v === "boolean") return v;
        throw new TypeError(
            `PaperSettingList: "${name()}" is ${typeof v} ${JSON.stringify(v)}, but a ${control} takes a boolean`,
        );
    };
}

/** A text or choice control's value from the record: a string, a number, or nothing. */
export function useSettingListText(
    name: () => string | undefined,
    control: string,
): () => string | number | undefined {
    const value = useSettingListValue(name);
    return () => {
        const v = value();
        if (v === undefined || typeof v === "string" || typeof v === "number") return v;
        throw new TypeError(
            `PaperSettingList: "${name()}" is ${typeof v} ${JSON.stringify(v)}, but a ${control} takes a string or a number`,
        );
    };
}
