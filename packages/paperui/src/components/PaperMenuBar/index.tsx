import styles from "./index.module.css";
import {
    createContext,
    createEffect,
    createSignal,
    createUniqueId,
    onCleanup,
    splitProps,
    useContext,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperButton, type PaperButtonSize } from "../PaperButton";
import { PaperContextMenu } from "../PaperContextMenu";

interface MenuBarContextType {
    openId: () => string | null;
    open: (id: string) => void;
    close: () => void;
    /** the label that takes Tab; the bar is one tab stop, arrows move within it */
    tabStopId: () => string | null;
    setTabStop: (id: string) => void;
    register: (id: string) => () => void;
    isFirst: (id: string) => boolean;
}

const MenuBarContext = createContext<MenuBarContextType>();

function useMenuBar(): MenuBarContextType {
    const ctx = useContext(MenuBarContext);
    if (!ctx) {
        throw new Error("PaperMenuBarMenu must be rendered inside a PaperMenuBar");
    }
    return ctx;
}

const TRIGGER_SELECTOR = "[data-menubar-trigger]:not(:disabled)";

export interface PaperMenuBarProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function PaperMenuBar(props: ParentProps<PaperMenuBarProps>) {
    let barRef: HTMLDivElement | undefined;
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    const [openId, setOpenId] = createSignal<string | null>(null);
    const [tabStopId, setTabStopId] = createSignal<string | null>(null);
    const [registered, setRegistered] = createSignal<string[]>([]);

    const triggers = () =>
        barRef ? Array.from(barRef.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR)) : [];

    // Moves to the label `step` places from `from`, wrapping at the ends. An
    // open menu follows the move, like a desktop menu bar.
    const moveFrom = (from: HTMLElement, step: number) => {
        const all = triggers();
        const index = all.indexOf(from);
        if (index === -1 || all.length === 0) return;
        const next = all[(index + step + all.length) % all.length];
        const id = next.getAttribute("data-menubar-trigger");
        if (!id) return;
        setTabStopId(id);
        if (openId() !== null) setOpenId(id);
        next.focus();
    };

    const triggerFor = (id: string) =>
        triggers().find((el) => el.getAttribute("data-menubar-trigger") === id) ?? null;

    // While a menu is open the dropdown owns Up/Down/Enter/Escape (see
    // PaperContextMenu); the bar adds Left/Right between menus. It listens on
    // the window, not the label, because focus may be anywhere once a menu is
    // open. Left/Right inside a submenu stay the submenu's.
    createEffect(() => {
        const id = openId();
        if (id === null) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const menu = document.querySelector(`[data-menubar-menu="${id}"]`);
            const active = menu?.getAttribute("aria-activedescendant");
            const item = active ? document.getElementById(active) : null;
            if (e.key === "ArrowRight" && item?.hasAttribute("data-context-sub")) return;
            if (e.key === "ArrowLeft" && item?.closest("[data-context-parent]")) return;

            const from = triggerFor(id);
            if (!from) return;
            e.preventDefault();
            moveFrom(from, e.key === "ArrowRight" ? 1 : -1);
        };

        window.addEventListener("keydown", handleKeyDown);
        onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
    });

    // Keys on a focused label while every menu is closed.
    const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
        if (openId() !== null) return;
        const from = (e.target as HTMLElement).closest<HTMLElement>(TRIGGER_SELECTOR);
        if (!from) return;
        const id = from.getAttribute("data-menubar-trigger");
        if (!id) return;

        if (e.key === "ArrowRight") {
            e.preventDefault();
            moveFrom(from, 1);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            moveFrom(from, -1);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            // the key goes on to the dropdown that opens, which highlights
            // its first (Down) or last (Up) item
            setOpenId(id);
        } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            const all = triggers();
            const edge = e.key === "Home" ? all[0] : all[all.length - 1];
            const edgeId = edge?.getAttribute("data-menubar-trigger");
            if (edge && edgeId) {
                setTabStopId(edgeId);
                edge.focus();
            }
        }
    };

    const context: MenuBarContextType = {
        openId,
        open: setOpenId,
        close: () => setOpenId(null),
        tabStopId,
        setTabStop: setTabStopId,
        register: (id) => {
            setRegistered((prev) => [...prev, id]);
            return () => setRegistered((prev) => prev.filter((other) => other !== id));
        },
        isFirst: (id) => registered()[0] === id,
    };

    return (
        <MenuBarContext.Provider value={context}>
            <div
                {...rest}
                ref={barRef}
                role="menubar"
                aria-orientation="horizontal"
                class={[styles.PaperMenuBar, local.class].filter(Boolean).join(" ")}
                classList={local.classList}
                onKeyDown={handleKeyDown}
            >
                {local.children}
            </div>
        </MenuBarContext.Provider>
    );
}

export interface PaperMenuBarMenuProps
    extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    /** The text on the bar. */
    label: JSX.Element | string;
    disabled?: boolean;
    /** The label's size: small by default, tiny for a bar under a title. */
    size?: PaperButtonSize;
    /** The dropdown opens as a compact menu: smaller items for a dense toolbar. */
    compact?: boolean;
    /** The dropdown: PaperContextMenuItem, PaperContextMenuSub, PaperSeparator. */
    children?: JSX.Element;
}

export function PaperMenuBarMenu(props: PaperMenuBarMenuProps) {
    const bar = useMenuBar();
    const id = createUniqueId();
    const [local, rest] = splitProps(props, [
        "label",
        "disabled",
        "size",
        "compact",
        "class",
        "classList",
        "children",
    ]);
    const [trigger, setTrigger] = createSignal<HTMLButtonElement>();

    const isOpen = () => bar.openId() === id;
    const tabbable = () => {
        const stop = bar.tabStopId();
        return stop === null ? bar.isFirst(id) : stop === id;
    };

    onCleanup(bar.register(id));

    const handleClose = () => {
        // a menu the bar already moved away from has nothing left to close
        if (!isOpen()) return;
        const active = document.activeElement;
        const panel = document.querySelector(`[data-menubar-menu="${id}"]`);
        bar.close();
        // a pick or Escape unmounts the item that held focus: hand it back to
        // the label, but never take it from a field the user clicked into
        if (!active || active === document.body || panel?.contains(active)) {
            trigger()?.focus();
        }
    };

    const handlePointerEnter: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (e) => {
        // a touch has no hover: its tap on a label is the click that switches
        if (e.pointerType === "touch" || local.disabled) return;
        if (bar.openId() !== null && !isOpen()) bar.open(id);
    };

    return (
        <>
            <PaperButton
                {...rest}
                ref={setTrigger}
                id={`${id}-trigger`}
                variant="text"
                size={local.size ?? "small"}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen()}
                disabled={local.disabled}
                tabIndex={tabbable() ? 0 : -1}
                data-menubar-trigger={id}
                class={[styles.trigger, local.class].filter(Boolean).join(" ")}
                classList={local.classList}
                onClick={() => {
                    if (isOpen()) handleClose();
                    else bar.open(id);
                }}
                onFocus={() => bar.setTabStop(id)}
                onPointerEnter={handlePointerEnter}
            >
                {local.label}
            </PaperButton>
            <PaperContextMenu
                open={isOpen()}
                target={trigger() ?? null}
                placement="below-left"
                overlay={false}
                compact={local.compact}
                onClose={handleClose}
                class={styles.dropdown}
                data-menubar-menu={id}
                aria-labelledby={`${id}-trigger`}
            >
                {local.children}
            </PaperContextMenu>
        </>
    );
}
