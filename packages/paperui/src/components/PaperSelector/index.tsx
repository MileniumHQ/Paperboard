import styles from "./index.module.css";
import { splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { PaperEffect } from "../PaperEffect";
import {
    SelectionProvider,
    SelectionRadioInput,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";

export type PaperSelectorProps = SelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement> & {
        direction?: "horizontal" | "vertical";
        horizontal?: boolean;
    };

export function PaperSelector(props: ParentProps<PaperSelectorProps>) {
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "direction",
        "horizontal",
        "class",
        "classList",
        "children",
    ]);

    const isHorizontal = () =>
        local.direction === "horizontal" || Boolean(local.horizontal);

    const className = () =>
        [
            styles.PaperSelector,
            isHorizontal() ? styles.horizontal : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <SelectionProvider
            name={local.name}
            value={local.value}
            defaultValue={local.defaultValue}
            onValueChange={local.onValueChange}
        >
            <div {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </SelectionProvider>
    );
}

export interface PaperSelectorItemProps
    extends JSX.InputHTMLAttributes<HTMLInputElement> {
    value: string | number;
    description?: JSX.Element | string;
    icon?: JSX.Element | string;
    disabled?: boolean;
    colorless?: boolean;
    reverse?: boolean;
}

export function PaperSelectorItem(props: ParentProps<PaperSelectorItemProps>) {
    const [local, rest] = splitProps(props, [
        "value",
        "description",
        "icon",
        "disabled",
        "colorless",
        "reverse",
        "class",
        "classList",
        "children",
    ]);

    const { isSelected } = useSelectionItem(local.value, local.disabled);

    const className = () =>
        [
            styles.PaperSelectorItem,
            isSelected() ? styles.selected : "",
            local.reverse ? styles.reverse : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <PaperEffect
            colorless={local.colorless ?? !isSelected()}
            disabled={local.disabled}
            class={className()}
            classList={local.classList}
        >
            <label class={styles.itemInner}>
                <SelectionRadioInput {...rest} value={local.value} disabled={local.disabled} />

                <Show when={local.icon}>
                    {typeof local.icon === "string" ? (
                        <PaperIcon class={styles.itemIcon} zeroHeight>
                            {local.icon}
                        </PaperIcon>
                    ) : (
                        <span class={styles.itemIcon}>{local.icon}</span>
                    )}
                </Show>

                <div class={styles.itemText}>
                    <PaperText class={styles.itemTitle} size={3} weight={500}>
                        {local.children}
                    </PaperText>
                    <Show when={local.description}>
                        <PaperText class={styles.itemDescription} size={1} weight={600}>
                            {local.description}
                        </PaperText>
                    </Show>
                </div>
            </label>
        </PaperEffect>
    );
}
