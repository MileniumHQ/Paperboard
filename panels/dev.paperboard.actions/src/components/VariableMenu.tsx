import { Show, For, createSignal, createMemo, createEffect, onMount, onCleanup } from "solid-js";
import { PaperIcon } from "@paperboard-dev/paperui";
import { variableFieldIcon } from "../lib/variableTypes";

export interface VariableMenuItem {
    id: string;
    label: string;
    icon?: string;
    description?: string;
    sourceBlockId?: string;
    sourceName?: string;
    type?: string;
    /** panel-supplied display name for the type badge */
    typeName?: string;
}

export interface VariableMenuProps {
    open: boolean;
    x: number;
    y: number;
    items: VariableMenuItem[];
    onSelect: (item: VariableMenuItem) => void;
    onClose: () => void;
    onHoverItem?: (sourceBlockId: string | null) => void;
}

const TYPE_BADGE_LABELS: Record<string, string> = {
    "discord-channel": "Channel",
    "discord-user": "User",
    "discord-role": "Role",
    "discord-message": "Message",
    "discord-embed": "Embed",
    "discord-component": "Component",
    "discord-interaction": "Interaction",
    string: "Text",
    number: "Number",
    boolean: "True/False",
    object: "Data",
    any: "Any",
    url: "URL",
    color: "Color",
};

function badgeLabel(type?: string, typeName?: string): string {
    if (typeName) return typeName;
    if (!type) return "Var";
    return TYPE_BADGE_LABELS[type] || type;
}



interface MenuGroup {
    key: string;
    name: string;
    items: VariableMenuItem[];
}

export default function VariableMenu(props: VariableMenuProps) {
    let menuRef: HTMLDivElement | undefined;

    const [activeKey, setActiveKey] = createSignal<string | null>(null);

    const menuLeft = () => {
        const width = menuRef ? menuRef.offsetWidth : 280;
        return Math.max(12, Math.min(window.innerWidth - width - 12, Math.round(props.x)));
    };
    const menuTop = () => {
        const height = menuRef ? menuRef.offsetHeight : 240;
        if (props.y + height > window.innerHeight - 12) {
            return Math.max(12, props.y - height - 28);
        }
        return Math.max(12, Math.round(props.y));
    };

    createEffect(() => {
        if (!props.open) {
            setActiveKey(null);
            props.onHoverItem?.(null);
        }
    });

    const groups = createMemo<MenuGroup[]>(() => {
        const map = new Map<string, MenuGroup>();
        for (const item of props.items) {
            const key = item.sourceBlockId || "other";
            const name = item.sourceName || item.description || "Variables";
            let group = map.get(key);
            if (!group) {
                group = { key, name, items: [] };
                map.set(key, group);
            }
            group.items.push(item);
        }
        return [...map.values()];
    });

    const itemKey = (item: VariableMenuItem) =>
        `${item.sourceBlockId || ""}:${item.id}:${item.label}`;

    onMount(() => {
        const handlePointerDown = (e: PointerEvent) => {
            if (props.open && menuRef && !menuRef.contains(e.target as Node)) {
                props.onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (props.open && e.key === "Escape") {
                props.onClose();
            }
        };

        // the menu is fixed to the screen, so scrolling the canvas would
        // leave it floating away from its block: close instead. Scrolling
        // inside the menu itself is how you reach the rest of the list.
        const handleScroll = (e: Event) => {
            if (!props.open) return;
            const target = e.target;
            if (menuRef && target instanceof Node && menuRef.contains(target)) return;
            props.onClose();
        };

        window.addEventListener("pointerdown", handlePointerDown, { capture: true });
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("scroll", handleScroll, {
            capture: true,
            passive: true,
        });

        onCleanup(() => {
            window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("scroll", handleScroll, { capture: true });
        });
    });

    return (
        <Show when={props.open}>
            <div
                ref={menuRef}
                class="actionVariableMenu"
                onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
                style={{
                    left: `${menuLeft()}px`,
                    top: `${menuTop()}px`,
                }}
            >
                <Show
                    when={props.items.length > 0}
                    fallback={
                        <div class="actionVariableMenuEmpty">
                            No variables available
                        </div>
                    }
                >
                    <div class="actionVariableMenuGroups">
                        <For each={groups()}>
                            {(group) => (
                                <div class="actionVariableMenuGroup">
                                    <div class="actionVariableMenuGroupHeader">
                                        <span class="actionVariableMenuGroupName">
                                            {group.name}
                                        </span>
                                        <span class="actionVariableMenuGroupCount">
                                            {group.items.length}
                                        </span>
                                    </div>
                                    <For each={group.items}>
                                        {(item) => (
                                            <div
                                                class={`actionVariableMenuItem ${activeKey() === itemKey(item) ? "isActive" : ""}`}
                                                onPointerDown={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onPointerEnter={() => {
                                                    setActiveKey(itemKey(item));
                                                    props.onHoverItem?.(item.sourceBlockId || null);
                                                }}
                                                onPointerLeave={() => {
                                                    setActiveKey(null);
                                                    props.onHoverItem?.(null);
                                                }}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    props.onHoverItem?.(null);
                                                    props.onSelect(item);
                                                }}
                                            >
                                                <div class="actionVariableMenuItemLeft">
                                                    <PaperIcon>
                                                        {variableFieldIcon(item.type, item.icon)}
                                                    </PaperIcon>
                                                    <span class="actionVariableMenuItemLabel">
                                                        {item.label}
                                                    </span>
                                                </div>
                                                <span class="actionVariableMenuTypeBadge">
                                                    {badgeLabel(item.type, item.typeName)}
                                                </span>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </Show>
    );
}
