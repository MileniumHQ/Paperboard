import { Show, For, onMount, onCleanup } from "solid-js";
import { PaperIcon } from "@paperboard-dev/paperui";

export interface ActionDropdownMenuItem {
    label: string;
    value: any;
    icon?: string;
}

export interface ActionDropdownMenuProps {
    open: boolean;
    x: number;
    y: number;
    items: ActionDropdownMenuItem[];
    selectedValue?: any;
    onSelect: (value: any) => void;
    onClose: () => void;
}

export default function ActionDropdownMenu(props: ActionDropdownMenuProps) {
    let menuRef: HTMLDivElement | undefined;

    const menuLeft = () => {
        const width = menuRef ? menuRef.offsetWidth : 190;
        return Math.max(12, Math.min(window.innerWidth - width - 12, Math.round(props.x)));
    };
    const menuTop = () => {
        const height = menuRef ? menuRef.offsetHeight : 180;
        if (props.y + height > window.innerHeight - 12) {
            return Math.max(12, props.y - height - 28);
        }
        return Math.max(12, Math.round(props.y));
    };

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

        window.addEventListener("pointerdown", handlePointerDown, { capture: true });
        window.addEventListener("keydown", handleKeyDown);

        onCleanup(() => {
            window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
            window.removeEventListener("keydown", handleKeyDown);
        });
    });

    return (
        <Show when={props.open && props.items.length > 0}>
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
                <For each={props.items}>
                    {(item) => {
                        const isSelected = () => item.value === props.selectedValue;
                        return (
                            <div
                                class={`actionVariableMenuItem ${isSelected() ? "selectedOption" : ""}`}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    props.onSelect(item.value);
                                }}
                            >
                                <div class="actionVariableMenuItemLeft">
                                    <Show when={item.icon}>
                                        <PaperIcon>{item.icon}</PaperIcon>
                                    </Show>
                                    <span class="actionVariableMenuItemLabel">
                                        {item.label}
                                    </span>
                                </div>
                                <Show when={isSelected()}>
                                    <PaperIcon class="actionOptionCheck">check</PaperIcon>
                                </Show>
                            </div>
                        );
                    }}
                </For>
            </div>
        </Show>
    );
}
