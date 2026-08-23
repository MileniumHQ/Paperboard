import styles from "./index.module.css";
import { splitProps, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    SelectionRadioInput,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";

export type PaperRailProps = SelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement>;

export function PaperRail(props: ParentProps<PaperRailProps>) {
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [styles.PaperRail, local.class].filter(Boolean).join(" ");

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

export interface PaperRailItemProps
    extends JSX.HTMLAttributes<HTMLLabelElement> {
    value: string | number;
    icon: JSX.Element | string;
    label?: JSX.Element | string;
    disabled?: boolean;
}

export function PaperRailItem(props: PaperRailItemProps) {
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "label",
        "disabled",
        "class",
        "classList",
    ]);

    const { isSelected } = useSelectionItem(local.value, local.disabled);

    const className = () =>
        [
            styles.PaperRailItem,
            isSelected() ? styles.selected : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <label
            {...rest}
            class={className()}
            classList={local.classList}
            title={typeof local.label === "string" ? local.label : undefined}
        >
            <SelectionRadioInput value={local.value} disabled={local.disabled} />
            {typeof local.icon === "string" ? (
                <PaperIcon class={styles.railIcon} zeroHeight>
                    {local.icon}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{local.icon}</span>
            )}
        </label>
    );
}

export interface PaperRailActionProps
    extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: JSX.Element | string;
    label?: JSX.Element | string;
}

export function PaperRailAction(props: PaperRailActionProps) {
    const [local, rest] = splitProps(props, [
        "icon",
        "label",
        "class",
        "classList",
    ]);

    const className = () =>
        [styles.PaperRailItem, styles.railAction, local.class]
            .filter(Boolean)
            .join(" ");

    return (
        <button
            type="button"
            {...rest}
            class={className()}
            classList={local.classList}
            title={typeof local.label === "string" ? local.label : undefined}
        >
            {typeof local.icon === "string" ? (
                <PaperIcon class={styles.railIcon} zeroHeight>
                    {local.icon}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{local.icon}</span>
            )}
        </button>
    );
}
