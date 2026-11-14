import styles from "./index.module.css";
import {
    splitProps,
    children,
    createMemo,
    createSignal,
    Show,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperText } from "../../components/PaperText";
import { PaperFlex } from "../PaperFlex";
import { PaperSettingListContext } from "../../contexts/settingList";
import { mergeStyle } from "../../utils/style";
import { cx } from "../../utils/cx";

export interface PaperSettingListProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value?: Record<string, any>;
    defaultValue?: Record<string, any>;
    onValueChange?: (values: Record<string, any>) => void;
    autoHeight?: boolean;
    /** Drop the card border and rounding for full-bleed panes. */
    flat?: boolean;
    flex?: boolean | number | JSX.CSSProperties["flex"];
}

export function PaperSettingList(props: ParentProps<PaperSettingListProps>) {
    let containerRef: HTMLDivElement | undefined;

    const [local, rest] = splitProps(props, [
        "value",
        "defaultValue",
        "onValueChange",
        "autoHeight",
        "flat",
        "flex",
        "class",
        "classList",
        "style",
        "children",
    ]);

    // uncontrolled: the list keeps what its controls change
    const [ownData, setOwnData] = createSignal<Record<string, any>>(local.defaultValue ?? {});
    // controlled: the record is the prop itself, read once per change of it
    const dataStore = createMemo(() => {
        const value = local.value;
        return value !== undefined ? value : ownData();
    });

    // what the edit under way last asked for: a PaperToggle or PaperCheckbox
    // reports one edit as both an input and a change event, and a parent
    // that has not taken the first must not be asked twice
    let asked: { name: string; value: unknown } | null = null;

    const handleFormEvent = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (!target || !target.name) return;

        const val =
            target instanceof HTMLInputElement && target.type === "checkbox"
                ? target.checked
                : target.value;

        // a text field fires input then change, and a PaperToggle both at
        // once: the second event of one edit carries nothing new
        if (dataStore()[target.name] === val) return;
        if (asked && asked.name === target.name && asked.value === val) return;
        asked = { name: target.name, value: val };
        queueMicrotask(() => (asked = null));

        const nextData = {
            ...dataStore(),
            [target.name]: val,
        };

        if (local.value === undefined) setOwnData(nextData);
        local.onValueChange?.(nextData);
    };

    const className = () =>
        cx(
            styles.PaperSettingList,
            local.autoHeight ? styles.autoHeight : "",
            local.flat ? styles.flat : "",
            local.class,
        );

    const dynamicStyle = () => {
        const extra: JSX.CSSProperties = {};
        if (local.flex !== undefined) {
            extra.flex =
                local.flex === true
                    ? "1 1 0%"
                    : local.flex === false
                      ? "none"
                      : typeof local.flex === "number"
                        ? `${local.flex} ${local.flex} 0%`
                        : local.flex;
        }
        return mergeStyle(extra, local.style);
    };

    return (
        <PaperSettingListContext.Provider value={{ valueOf: (name) => dataStore()[name] }}>
            <div
                ref={containerRef}
                {...rest}
                class={className()}
                classList={local.classList}
                style={dynamicStyle()}
                onInput={handleFormEvent}
                onChange={handleFormEvent}
            >
                {local.children}
            </div>
        </PaperSettingListContext.Provider>
    );
}

export interface PaperSettingItemProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    title: JSX.Element | string;
    description?: JSX.Element | string;
    disabled?: boolean;
}

export function PaperSettingItem(props: ParentProps<PaperSettingItemProps>) {
    const [local, rest] = splitProps(props, [
        "title",
        "description",
        "disabled",
        "class",
        "classList",
        "children",
    ]);
    const description = children(() => local.description);

    return (
        <div
            {...rest}
            class={cx(
                styles.PaperSettingItem,
                local.disabled ? styles.disabled : "",
                local.class,
            )}
            classList={local.classList}
        >
            <PaperFlex direction="column" gap="onefourth" class={styles.text}>
                <PaperText preset="label">
                    {local.title}
                </PaperText>
                <Show when={description()}>
                    <PaperText preset="hint">
                        {description()}
                    </PaperText>
                </Show>
            </PaperFlex>

            <PaperFlex direction="row" align="center" justify="flex-end" class={styles.control}>
                {local.children}
            </PaperFlex>
        </div>
    );
}
