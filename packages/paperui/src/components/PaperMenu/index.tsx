import styles from "./index.module.css";
import {
    createContext,
    useContext,
    createSignal,
    splitProps,
    onCleanup,
    onMount,
    Show,
    type ParentProps,
    type JSX,
} from "solid-js";
import { usePaperPanel } from "../../contexts/panel";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import {
    SelectionProvider,
    SelectionRadioInput,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";

import type { PaperSpacing } from "../../types";
import { resolveSpacing } from "../../utils/theme";

const MenuLevelContext = createContext<number>(0);
// true for a PaperPanel's navigation menu: its entries open the panel's
// interface page in the phone layout
const PanelNavContext = createContext<boolean>(false);

export function useMenuLevel() {
    return useContext(MenuLevelContext) ?? 0;
}

export type PaperMenuSpacing = boolean | PaperSpacing;

export type PaperMenuProps = SelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement> & {
        direction?: "horizontal" | "vertical";
        horizontal?: boolean;
        spacing?: PaperMenuSpacing;
        /** Drops the trailing divider and surface so the menu can sit inside a
         *  host sidebar that already provides its own frame. */
        embedded?: boolean;
    };

export function PaperMenu(props: ParentProps<PaperMenuProps>) {
    let menuRef: HTMLDivElement | undefined;
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "direction",
        "horizontal",
        "spacing",
        "embedded",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const isHorizontal = () => local.direction === "horizontal" || Boolean(local.horizontal);
    const panel = usePaperPanel();
    // a sidebar directly in a PaperPanel; a tab strip or an embedded menu
    // is some other surface's navigation
    const isPanelNav = Boolean(panel?.inPanel) && !isHorizontal() && !local.embedded;
    const isCompact = () => isPanelNav && Boolean(panel?.compact?.());

    const resolvedSpacing = () => {
        if (local.spacing === undefined) return undefined; // the stylesheet's default gap
        if (local.spacing === false) return "0px";
        if (local.spacing === true) return resolveSpacing("onefourth");
        return resolveSpacing(local.spacing);
    };

    const className = () =>
        [
            styles.PaperMenu,
            isHorizontal() ? styles.horizontal : "",
            local.spacing ? styles.spacing : "",
            local.embedded ? styles.embedded : "",
            isCompact() ? styles.compact : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const style = () => {
        const gapVal = resolvedSpacing();
        return {
            ...(gapVal ? { "--menu-spacing": gapVal } : {}),
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (!menuRef) return;
        const focusables = Array.from(
            menuRef.querySelectorAll<HTMLElement>(
                `label.${styles.PaperMenuItem}:not(.${styles.disabled}), .${styles.sectionHeader}[tabindex="0"]`
            )
        );
        if (focusables.length === 0) return;

        const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);

        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            e.preventDefault();
            const nextIndex = currentIndex < focusables.length - 1 ? currentIndex + 1 : 0;
            focusables[nextIndex]?.focus();
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusables.length - 1;
            focusables[prevIndex]?.focus();
        } else if (e.key === "Home") {
            e.preventDefault();
            focusables[0]?.focus();
        } else if (e.key === "End") {
            e.preventDefault();
            focusables[focusables.length - 1]?.focus();
        }
    };

    return (
        <SelectionProvider
            name={local.name}
            value={local.value}
            defaultValue={local.defaultValue}
            onValueChange={local.onValueChange}
        >
            <MenuLevelContext.Provider value={0}>
                <PanelNavContext.Provider value={isPanelNav}>
                    <div
                        ref={menuRef}
                        {...rest}
                        class={className()}
                        classList={local.classList}
                        style={style()}
                        inert={isCompact() && Boolean(panel?.pageOpen?.())}
                        onKeyDown={handleKeyDown}
                    >
                        {local.children}
                    </div>
                </PanelNavContext.Provider>
            </MenuLevelContext.Provider>
        </SelectionProvider>
    );
}

export interface PaperMenuSectionProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    title: string | JSX.Element;
    icon?: JSX.Element | string;
    defaultOpen?: boolean;
    open?: boolean;
    collapsible?: boolean;
}

export function PaperMenuSection(props: ParentProps<PaperMenuSectionProps>) {
    const [local, rest] = splitProps(props, [
        "title",
        "icon",
        "defaultOpen",
        "open",
        "collapsible",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const isCollapsible = () => local.collapsible ?? true;
    const [internalOpen, setInternalOpen] = createSignal(local.defaultOpen ?? true);

    const isOpen = () => (local.open !== undefined ? local.open : internalOpen());

    const toggleOpen = () => {
        if (!isCollapsible()) return;
        setInternalOpen(!isOpen());
    };

    const currentLevel = useMenuLevel();
    const nextLevel = currentLevel + 1;

    const style = () => ({
        "--menu-indent-level": currentLevel,
        ...(typeof local.style === "object" ? local.style : {}),
    });

    return (
        <div
            {...rest}
            class={[styles.PaperMenuSection, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            style={style()}
        >
            <div
                class={styles.sectionHeader}
                onClick={toggleOpen}
                tabIndex={isCollapsible() ? 0 : undefined}
                onKeyDown={(e) => {
                    if (isCollapsible() && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        toggleOpen();
                    }
                }}
            >
                <div class={styles.sectionTitle}>
                    <Show when={local.icon}>
                        {typeof local.icon === "string" ? (
                            <PaperIcon class={styles.menuIcon} zeroHeight>
                                {local.icon}
                            </PaperIcon>
                        ) : (
                            <span class={styles.menuIcon}>{local.icon}</span>
                        )}
                    </Show>
                    {typeof local.title === "string" ? (
                        <PaperText size={2} weight={700}>
                            {local.title}
                        </PaperText>
                    ) : (
                        local.title
                    )}
                </div>

                <Show when={isCollapsible()}>
                    <PaperIcon
                        class={[
                            styles.sectionChevron,
                            styles.menuIcon,
                            isOpen() ? styles.open : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        zeroHeight
                    >
                        chevron_right
                    </PaperIcon>
                </Show>
            </div>

            <Show when={isOpen()}>
                <MenuLevelContext.Provider value={nextLevel}>
                    <div class={styles.sectionContent}>{local.children}</div>
                </MenuLevelContext.Provider>
            </Show>
        </div>
    );
}

export interface PaperMenuItemProps
    extends JSX.InputHTMLAttributes<HTMLInputElement> {
    value: string | number;
    description?: JSX.Element | string;
    icon?: JSX.Element | string;
    disabled?: boolean;
    level?: number;
}

export function PaperMenuItem(props: ParentProps<PaperMenuItemProps>) {
    const [local, rest] = splitProps(props, [
        "value",
        "description",
        "icon",
        "disabled",
        "level",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const { isSelected, select } = useSelectionItem(local.value, local.disabled);
    const contextLevel = useMenuLevel();
    const panel = usePaperPanel();
    const isPanelNav = useContext(PanelNavContext);
    let textRef: HTMLDivElement | undefined;

    // the phone layout's page bar names the open entry with its title and icon
    // (on mount: the title is read from the rendered label)
    onMount(() => {
        if (!isPanelNav || !panel?.registerEntry) return;
        const unregister = panel.registerEntry(local.value, {
            // the title is the text block's first element; the description follows
            title: () => textRef?.firstElementChild?.textContent?.trim() || String(local.value),
            icon: typeof local.icon === "string" ? local.icon : undefined,
        });
        onCleanup(unregister);
    });

    // tapping an entry opens its page, even the entry already selected
    const activate = () => {
        if (local.disabled || !isPanelNav || !panel?.compact?.()) return;
        panel.openPage?.();
    };
    const effectiveLevel = () => local.level ?? contextLevel;

    const className = () =>
        [
            styles.PaperMenuItem,
            isSelected() ? styles.selected : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const style = () => ({
        "--menu-indent-level": effectiveLevel(),
        ...(typeof local.style === "object" ? local.style : {}),
    });

    return (
        <label
            tabIndex={local.disabled ? -1 : 0}
            class={className()}
            classList={local.classList}
            style={style()}
            onClick={activate}
            onKeyDown={(e) => {
                if (!local.disabled && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    select();
                    activate();
                }
            }}
        >
            <SelectionRadioInput {...rest} value={local.value} disabled={local.disabled} />

            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.menuIcon} zeroHeight>
                        {local.icon}
                    </PaperIcon>
                ) : (
                    <span class={styles.menuIcon}>{local.icon}</span>
                )}
            </Show>

            <div ref={textRef} class={styles.itemText}>
                <PaperText class={styles.menuTitle} size={2} weight={500}>
                    {local.children}
                </PaperText>
                <Show when={local.description}>
                    <PaperText class={styles.menuDescription} size={1} weight={600}>
                        {local.description}
                    </PaperText>
                </Show>
            </div>
        </label>
    );
}
