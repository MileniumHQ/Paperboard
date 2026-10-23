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
    createEffect,
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
    /** it fits what's typed in the search field (always, without one) */
    matches: Accessor<boolean>;
}

interface SelectMenuContextType {
    register: (option: RegisteredOption) => void;
    unregister: (value: string | number) => void;
    close: () => void;
    commit: (value: string | number) => void;
    disabled: () => boolean;
    /** what's typed in the search field, lowercased and trimmed; "" without one */
    query: Accessor<string>;
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
        /** a search field above the options, for long lists; it filters by label, description, value and keywords */
        searchable?: boolean;
        searchPlaceholder?: string;
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
        "searchable",
        "searchPlaceholder",
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
                searchable={local.searchable}
                searchPlaceholder={local.searchPlaceholder}
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
            searchable?: boolean;
            searchPlaceholder?: string;
            name?: string;
        }
    >,
) {
    const [local, rest] = splitProps(props, [
        "placeholder",
        "disabled",
        "fullWidth",
        "searchable",
        "searchPlaceholder",
        "name",
        "class",
        "classList",
        "children",
    ]);

    const selection = useSelectionContext();
    const [open, setOpen] = createSignal(false);
    const [options, setOptions] = createSignal<RegisteredOption[]>([]);
    const [search, setSearch] = createSignal("");
    const query = () => (local.searchable ? search().trim().toLowerCase() : "");
    const noMatches = () => query() !== "" && !options().some((o) => o.matches());
    // a closed menu forgets its search: it opens on the whole list
    createEffect(() => {
        if (!open()) setSearch("");
    });
    let hiddenInputRef: HTMLInputElement | undefined;
    let triggerEl: HTMLButtonElement | undefined;

    const menuContext: SelectMenuContextType = {
        register: (option) => {
            setOptions((prev) => [
                ...prev.filter((o) => o.value !== option.value),
                option,
            ]);
        },
        unregister: (value) => {
            setOptions((prev) => prev.filter((o) => o.value !== value));
        },
        close: () => setOpen(false),
        commit: (value) => commitValue(value),
        disabled: () => Boolean(local.disabled),
        query,
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
                    <Show when={local.searchable}>
                        <SearchField
                            open={open()}
                            value={search()}
                            placeholder={local.searchPlaceholder ?? "Search"}
                            onInput={setSearch}
                        />
                    </Show>
                    {local.children}
                    <Show when={noMatches()}>
                        <div class={styles.noMatches} role="status">
                            No matches
                        </div>
                    </Show>
                </PaperContextMenu>
            </div>
        </SelectMenuContext.Provider>
    );
}

/**
 * The search field at the top of a searchable menu. It takes focus when the menu opens; typing filters the
 * options and highlights the first one left, so Enter picks it and the arrows move through what's shown.
 */
function SearchField(props: { open: boolean; value: string; placeholder: string; onInput: (v: string) => void }) {
    const ctx = useContextMenu();
    let input: HTMLInputElement | undefined;
    createEffect(() => {
        if (props.open) requestAnimationFrame(() => input?.focus());
    });
    const highlightFirst = () =>
        queueMicrotask(() => {
            const first = input
                ?.closest("[role='listbox']")
                ?.querySelector<HTMLElement>("[data-context-item]:not([data-disabled='true'])");
            ctx?.setHighlightedItem(first?.getAttribute("data-context-item") ?? null);
        });
    return (
        <input
            ref={input}
            type="search"
            class={styles.search}
            aria-label={props.placeholder}
            placeholder={props.placeholder}
            autocomplete="off"
            spellcheck={false}
            value={props.value}
            onInput={(e) => {
                props.onInput(e.currentTarget.value);
                highlightFirst();
            }}
        />
    );
}

/** Every word typed appears somewhere in what the option says about itself. */
const fits = (query: string, haystack: string) => query.split(/\s+/).every((word) => haystack.includes(word));

export interface PaperSelectMenuItemProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    icon?: JSX.Element | string;
    /** Second line under the label, like a context menu item's description. */
    description?: JSX.Element | string;
    /** More words a search finds it by, besides its label, description and value. */
    keywords?: string;
    disabled?: boolean;
}

export function PaperSelectMenuItem(
    props: ParentProps<PaperSelectMenuItemProps>,
) {
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "description",
        "keywords",
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

    // what a search reads: the label and description when they're text, the value, the keywords
    const haystack = () =>
        [local.value, local.children, local.description, local.keywords]
            .filter((t) => typeof t === "string" || typeof t === "number")
            .join(" ")
            .toLowerCase();
    const matches = () => {
        const q = menu?.query() ?? "";
        return q === "" || fits(q, haystack());
    };

    onMount(() => {
        menu?.register({ value: local.value, label, icon: () => local.icon, matches });
        onCleanup(() => menu?.unregister(local.value));
    });

    // filtered out: still registered, so a selected option keeps its label on the trigger
    return (
        <Show when={matches()}>
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
        </Show>
    );
}
