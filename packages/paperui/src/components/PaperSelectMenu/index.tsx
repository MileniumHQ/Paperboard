import styles from "./index.module.css";
import { MenuItem } from "../shared/MenuItem";
import { PaperContextMenu } from "../PaperContextMenu";
import {
    splitProps,
    createSignal,
    createContext,
    useContext,
    onCleanup,
    onMount,
    Show,
    type ParentProps,
    type JSX,
    type Accessor,
} from "solid-js";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    useSelectionContext,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";
import { useContextMenu } from "../PaperContextMenu";

interface RegisteredOption {
    value: string | number;
    label: Accessor<JSX.Element>;
    icon: Accessor<JSX.Element | string | undefined>;
}

interface SelectMenuContextType {
    register: (
        value: string | number,
        label: Accessor<JSX.Element>,
        icon: Accessor<JSX.Element | string | undefined>,
    ) => void;
    unregister: (value: string | number) => void;
    close: () => void;
    commit: (value: string | number) => void;
    disabled: () => boolean;
}

const SelectMenuContext = createContext<SelectMenuContextType>();

function useSelectMenu() {
    return useContext(SelectMenuContext);
}

export type PaperSelectMenuProps = SelectionProviderProps &
    Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "onInput"> & {
        placeholder?: string;
        disabled?: boolean;
        fullWidth?: boolean;
    };

export function PaperSelectMenu(props: ParentProps<PaperSelectMenuProps>) {
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "placeholder",
        "disabled",
        "fullWidth",
        "class",
        "classList",
        "children",
    ]);

    return (
        <SelectionProvider
            name={local.name}
            value={local.value}
            defaultValue={local.defaultValue}
            onValueChange={local.onValueChange}
        >
            <SelectMenuInner
                {...rest}
                placeholder={local.placeholder}
                disabled={local.disabled}
                fullWidth={local.fullWidth}
                name={local.name}
                class={local.class}
                classList={local.classList}
            >
                {local.children}
            </SelectMenuInner>
        </SelectionProvider>
    );
}

function SelectMenuInner(
    props: ParentProps<
        JSX.HTMLAttributes<HTMLDivElement> & {
            placeholder?: string;
            disabled?: boolean;
            fullWidth?: boolean;
            name?: string;
        }
    >,
) {
    const [local, rest] = splitProps(props, [
        "placeholder",
        "disabled",
        "fullWidth",
        "name",
        "class",
        "classList",
        "children",
    ]);

    const selection = useSelectionContext();
    const [open, setOpen] = createSignal(false);
    const [options, setOptions] = createSignal<RegisteredOption[]>([]);
    let hiddenInputRef: HTMLInputElement | undefined;
    let triggerEl: HTMLButtonElement | undefined;

    const menuContext: SelectMenuContextType = {
        register: (value, label, icon) => {
            setOptions((prev) => [
                ...prev.filter((o) => o.value !== value),
                { value, label, icon },
            ]);
        },
        unregister: (value) => {
            setOptions((prev) => prev.filter((o) => o.value !== value));
        },
        close: () => setOpen(false),
        commit: (value) => commitValue(value),
        disabled: () => Boolean(local.disabled),
    };

    const currentValue = () => selection.currentValue();
    const selectedOption = () => {
        const current = currentValue();
        if (current === undefined || current === "") return undefined;
        return options().find((o) => o.value === current);
    };
    const selectedLabel = () => {
        const registered = selectedOption();
        if (registered) return registered.label();
        const current = currentValue();
        return current === undefined || current === "" ? undefined : String(current);
    };
    // the trigger mirrors the selected option's icon, so a maker logo or
    // glyph is visible without opening the menu
    const selectedIcon = () => selectedOption()?.icon();

    const commitValue = (value: string | number) => {
        if (local.disabled) return;
        selection.setValue(value);
        setOpen(false);
        const input = hiddenInputRef;
        if (input && local.name) {
            input.value = String(value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
    };

    const toggleOpen = () => {
        if (local.disabled) return;
        setOpen(!open());
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (local.disabled) return;
        switch (e.key) {
            case "Enter":
            case " ":
            case "ArrowDown":
            case "ArrowUp": {
                if (open()) {
                    // while open the shared menu owns highlight, navigation
                    // and selection; this key must reach its window handler
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                toggleOpen();
                break;
            }
            case "Escape": {
                if (open()) {
                    e.stopPropagation();
                    setOpen(false);
                }
                break;
            }
        }
    };

    // Dismissal on presses outside the popup belongs to PaperContextMenu: it
    // is the one that knows where its panel is, and it treats this trigger as
    // inside so a press on either the trigger or an option reaches its click.
    // A second document listener here used to close the portaled popup on the
    // press that started an option click, so no option ever committed.

    const className = () =>
        [
            styles.PaperSelectMenu,
            local.fullWidth ? styles.fullWidth : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <SelectMenuContext.Provider value={menuContext}>
            <div
                {...rest}
                class={className()}
                classList={local.classList}
                onKeyDown={handleKeyDown}
            >
                <Show when={local.name}>
                    <input
                        ref={hiddenInputRef}
                        type="text"
                        name={local.name}
                        value={String(currentValue() ?? "")}
                        tabindex={-1}
                        aria-hidden="true"
                        style={{
                            position: "absolute",
                            width: "0.0625rem",
                            height: "0.0625rem",
                            opacity: "0",
                            "pointer-events": "none",
                        }}
                    />
                </Show>

                <button
                    type="button"
                    ref={triggerEl}
                    class={styles.trigger}
                    disabled={local.disabled}
                    onClick={() => toggleOpen()}
                    aria-haspopup="listbox"
                    aria-expanded={open()}
                >
                    <span class={styles.triggerLabel}>
                        <Show when={selectedIcon()}>
                            {typeof selectedIcon() === "string" ? (
                                <PaperIcon zeroHeight class={styles.triggerIcon}>
                                    {selectedIcon() as string}
                                </PaperIcon>
                            ) : (
                                <span class={styles.triggerIcon}>{selectedIcon()}</span>
                            )}
                        </Show>
                        <Show
                            when={selectedLabel()}
                            fallback={
                                <span class={styles.placeholder}>
                                    {local.placeholder ?? "Select…"}
                                </span>
                            }
                        >
                            {selectedLabel()}
                        </Show>
                    </span>
                    <PaperIcon zeroHeight class={styles.chevron}>
                        expand_more
                    </PaperIcon>
                </button>

                <PaperContextMenu
                    open={open()}
                    target={triggerEl}
                    placement="below"
                    role="listbox"
                    keepMounted
                    matchTargetWidth
                    initialHighlight={currentValue() ?? null}
                    onClose={() => setOpen(false)}
                >
                    {local.children}
                </PaperContextMenu>
            </div>
        </SelectMenuContext.Provider>
    );
}

export interface PaperSelectMenuItemProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    icon?: JSX.Element | string;
    /** Second line under the label, like a context menu item's description. */
    description?: JSX.Element | string;
    disabled?: boolean;
}

export function PaperSelectMenuItem(
    props: ParentProps<PaperSelectMenuItemProps>,
) {
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "description",
        "disabled",
        "class",
        "classList",
        "children",
    ]);

    const menu = useSelectMenu();
    const ctx = useContextMenu();
    const { isSelected } = useSelectionItem(local.value, local.disabled);

    const label: Accessor<JSX.Element> = () => local.children as JSX.Element;
    const itemValue = () => String(local.value);
    const isHighlighted = () => ctx?.highlightedItem() === itemValue();

    onMount(() => {
        menu?.register(local.value, label, () => local.icon);
        onCleanup(() => menu?.unregister(local.value));
    });

    return (
        <MenuItem
            {...rest}
            role="option"
            aria-selected={isSelected()}
            data-context-item={itemValue()}
            data-disabled={local.disabled ? "true" : "false"}
            data-select-value={local.value}
            icon={local.icon}
            description={local.description}
            disabled={local.disabled}
            highlighted={isHighlighted()}
            checked={isSelected()}
            class={local.class}
            classList={local.classList}
            onClick={() => {
                if (local.disabled) return;
                menu?.commit(local.value);
            }}
            onPointerEnter={() => ctx?.setHighlightedItem(itemValue())}
            onPointerLeave={() => {
                if (ctx?.highlightedItem() === itemValue()) {
                    ctx?.setHighlightedItem(null);
                }
            }}
        >
            {local.children}
        </MenuItem>
    );
}
