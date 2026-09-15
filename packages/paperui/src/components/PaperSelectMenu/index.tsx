import styles from "./index.module.css";
import {
    splitProps,
    createSignal,
    createContext,
    createEffect,
    useContext,
    onMount,
    onCleanup,
    Show,
    type ParentProps,
    type JSX,
    type Accessor,
} from "solid-js";
import { Portal } from "solid-js/web";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    useSelectionContext,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";


interface RegisteredOption {
    value: string | number;
    label: Accessor<JSX.Element>;
}

interface SelectMenuContextType {
    register: (value: string | number, label: Accessor<JSX.Element>) => void;
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

    let containerRef: HTMLDivElement | undefined;

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
                    containerRef={(el) => (containerRef = el)}
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
            containerRef: (el: HTMLDivElement) => void;
        }
    >,
) {
    const [local, rest] = splitProps(props, [
        "placeholder",
        "disabled",
        "fullWidth",
        "name",
        "containerRef",
        "class",
        "classList",
        "children",
    ]);

    const selection = useSelectionContext();
    const [open, setOpen] = createSignal(false);
    const [highlighted, setHighlighted] = createSignal<string | number | null>(null);
    const [options, setOptions] = createSignal<RegisteredOption[]>([]);

    const menuContext: SelectMenuContextType = {
        register: (value, label) => {
            setOptions((prev) => [
                ...prev.filter((o) => o.value !== value),
                { value, label },
            ]);
        },
        unregister: (value) => {
            setOptions((prev) => prev.filter((o) => o.value !== value));
        },
        close: () => setOpen(false),
        commit: (value) => commitValue(value),
        disabled: () => Boolean(local.disabled),
    };

    let hiddenInputRef: HTMLInputElement | undefined;
    let triggerEl: HTMLButtonElement | undefined;
    let menuEl: HTMLDivElement | undefined;

    // portal floats above everything without a scroll parent
    const [menuPos, setMenuPos] = createSignal({ left: 0, top: 0, width: 0 });

    const positionMenu = () => {
        if (!triggerEl || !menuEl || !open()) return;
        const rect = triggerEl.getBoundingClientRect();
        const gap = 4;
        const margin = 8;
        const menuRect = menuEl.getBoundingClientRect();
        let top = rect.bottom + gap;
        if (top + menuRect.height > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - gap - menuRect.height);
        }
        let left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - menuRect.width - margin),
        );
        setMenuPos({ left: Math.round(left), top: Math.round(top), width: Math.round(rect.width) });
    };

    const scrollActiveIntoView = () => {
        const value = highlighted();
        if (value === null || !menuEl) return;
        const target = menuEl.querySelector(
            `[data-select-value="${CSS.escape(String(value))}"]`,
        ) as HTMLElement | null;
        target?.scrollIntoView?.({ block: "nearest" });
    };

    const currentValue = () => selection.currentValue();
    const selectedLabel = () => {
        const current = currentValue();
        if (current === undefined || current === "") return undefined;
        const registered = options().find((o) => o.value === current);
        return registered ? registered.label() : String(current);
    };

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

    const selectValue = (value: string | number) => commitValue(value);

    const toggleOpen = () => {
        if (local.disabled) return;
        const willOpen = !open();
        setOpen(willOpen);
        // signals fire synchronously, capture intent first
        if (willOpen) {
            setHighlighted(currentValue() ?? options()[0]?.value ?? null);
        }
    };

    const moveHighlight = (delta: number) => {
        const values = options().map((o) => o.value);
        if (values.length === 0) return;
        const index = values.indexOf(highlighted() as never);
        const next =
            index === -1
                ? delta > 0
                    ? 0
                    : values.length - 1
                : Math.min(values.length - 1, Math.max(0, index + delta));
        setHighlighted(values[next]);
        scrollActiveIntoView();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (local.disabled) return;
        switch (e.key) {
            case "Enter":
            case " ": {
                e.preventDefault();
                if (open()) {
                    if (highlighted() !== null) selectValue(highlighted() as string | number);
                } else {
                    toggleOpen();
                }
                break;
            }
            case "Escape": {
                if (open()) {
                    e.stopPropagation();
                    setOpen(false);
                }
                break;
            }
            case "ArrowDown": {
                e.preventDefault();
                if (!open()) toggleOpen();
                else moveHighlight(1);
                break;
            }
            case "ArrowUp": {
                e.preventDefault();
                if (!open()) toggleOpen();
                else moveHighlight(-1);
                break;
            }
            case "Home": {
                if (open()) {
                    e.preventDefault();
                    setHighlighted(options()[0]?.value ?? null);
                }
                break;
            }
            case "End": {
                if (open()) {
                    e.preventDefault();
                    setHighlighted(options()[options().length - 1]?.value ?? null);
                }
                break;
            }
        }
    };

    // menu needs a frame to measure before positioning
    createEffect(() => {
        if (!open()) return;
        requestAnimationFrame(positionMenu);
        const reposition = (e: Event) => {
            if (menuEl && menuEl.contains(e.target as Node)) return;
            positionMenu();
        };
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", positionMenu);
        onCleanup(() => {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", positionMenu);
        });
    });

    onMount(() => {
        const handleOutsidePointer = (e: PointerEvent) => {
            if (!open()) return;
            const target = e.target as Node;
            if (containerEl && !containerEl.contains(target) && !menuEl?.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", handleOutsidePointer, true);
        onCleanup(() =>
            document.removeEventListener("pointerdown", handleOutsidePointer, true),
        );
    });

    let containerEl: HTMLDivElement | undefined;

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
            ref={(el) => {
                containerEl = el;
                local.containerRef(el);
            }}
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

            {/* always mounted so labels register for the trigger */}
            <Portal>
                <div
                    ref={menuEl}
                    class={[styles.menu, open() ? "" : styles.menuClosed]
                        .filter(Boolean)
                        .join(" ")}
                    role="listbox"
                    aria-hidden={!open()}
                    style={{
                        left: `${menuPos().left}px`,
                        top: `${menuPos().top}px`,
                        width: `${Math.max(menuPos().width, 160)}px`,
                    }}
                >
                    {local.children}
                </div>
            </Portal>
        </div>
        </SelectMenuContext.Provider>
    );
}

export interface PaperSelectMenuItemProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    icon?: JSX.Element | string;
    disabled?: boolean;
}

export function PaperSelectMenuItem(
    props: ParentProps<PaperSelectMenuItemProps>,
) {
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "disabled",
        "class",
        "classList",
        "children",
    ]);

    const menu = useSelectMenu();
    const { isSelected } = useSelectionItem(local.value, local.disabled);

    let optionEl: HTMLDivElement | undefined;

    const label: Accessor<JSX.Element> = () => local.children as JSX.Element;

    onMount(() => {
        menu?.register(local.value, label);
        onCleanup(() => menu?.unregister(local.value));
    });

    const className = () =>
        [
            styles.option,
            isSelected() ? styles.optionSelected : "",
            local.disabled ? styles.optionDisabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            ref={optionEl}
            role="option"
            aria-selected={isSelected()}
            data-select-value={local.value}
            class={className()}
            classList={local.classList}
            onClick={() => {
                if (local.disabled) return;
                menu?.commit(local.value);
            }}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon zeroHeight class={styles.optionIcon}>
                        {local.icon}
                    </PaperIcon>
                ) : (
                    <span class={styles.optionIcon}>{local.icon}</span>
                )}
            </Show>
            <span class={styles.optionLabel}>{local.children}</span>
            <Show when={isSelected()}>
                <PaperIcon zeroHeight class={styles.optionCheck}>
                    check
                </PaperIcon>
            </Show>
        </div>
    );
}
