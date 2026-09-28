import styles from "./index.module.css";
import {
    splitProps,
    createSignal,
    createEffect,
    Show,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperText } from "../../components/PaperText";
import { PaperFlex } from "../PaperFlex";

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

    const [dataStore, setDataStore] = createSignal<Record<string, any>>(
        local.value ?? local.defaultValue ?? {}
    );

    createEffect(() => {
        if (local.value !== undefined) {
            setDataStore(local.value);
        }
    });

    const handleFormEvent = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (!target || !target.name) return;

        const val =
            target instanceof HTMLInputElement && target.type === "checkbox"
                ? target.checked
                : target.value;

        const nextData = {
            ...dataStore(),
            [target.name]: val,
        };

        setDataStore(nextData);
        local.onValueChange?.(nextData);
    };

    const className = () =>
        [
            styles.PaperSettingList,
            local.autoHeight ? styles.autoHeight : "",
            local.flat ? styles.flat : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

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
        return {
            ...extra,
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    return (
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

    return (
        <div
            {...rest}
            class={[
                styles.PaperSettingItem,
                local.disabled ? styles.disabled : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <PaperFlex direction="column" gap="onefourth" style={{ flex: 1, "min-width": 0 }}>
                <PaperText size={4} weight={600}>
                    {local.title}
                </PaperText>
                <Show when={local.description}>
                    <PaperText size={2} weight={500} color="text-subtle">
                        {local.description}
                    </PaperText>
                </Show>
            </PaperFlex>

            <PaperFlex direction="row" align="center" justify="flex-end">
                {local.children}
            </PaperFlex>
        </div>
    );
}
