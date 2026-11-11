// Blockly's right-click menus as PaperUI's context menu: each item with its
// symbol before its text, as PaperContextMenuItem draws one. Blockly's "Help"
// opens Blockly's website, which a panel doesn't, so it's gone.
import * as Blockly from "blockly";

/** the class of an item's symbol, styled in App.module.css */
export const MENU_ICON_CLASS = "paperMenuIcon";
/** the class of an item that deletes, drawn as PaperUI's danger item */
export const MENU_DANGER_CLASS = "paperMenuDanger";

const ICONS: Record<string, string> = {
    blockDuplicate: "content_copy",
    blockComment: "comment",
    blockInline: "view_column",
    blockCollapseExpand: "unfold_less",
    blockDisable: "block",
    blockDelete: "delete",
    undoWorkspace: "undo",
    redoWorkspace: "redo",
    cleanWorkspace: "format_align_left",
    collapseWorkspace: "unfold_less",
    expandWorkspace: "unfold_more",
    workspaceDelete: "delete",
    commentCreate: "add_comment",
    commentDuplicate: "content_copy",
    commentDelete: "delete",
};
const DANGER = new Set(["blockDelete", "workspaceDelete", "commentDelete"]);
const REMOVED = ["blockHelp"];

function withIcon(id: string, text: string | HTMLElement): HTMLElement {
    const row = document.createElement("span");
    row.className = DANGER.has(id) ? MENU_DANGER_CLASS : "";
    const icon = document.createElement("span");
    icon.className = MENU_ICON_CLASS;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICONS[id]!;
    row.append(icon, text);
    return row;
}

let done = false;

/** Gives Blockly's menu items their symbols. Once per page: the registry is Blockly's, shared by every workspace. */
export function paperContextMenus(): void {
    if (done) return;
    done = true;
    const registry = Blockly.ContextMenuRegistry.registry;
    for (const id of REMOVED) if (registry.getItem(id)) registry.unregister(id);
    for (const id of Object.keys(ICONS)) {
        const item = registry.getItem(id);
        if (!item || !("displayText" in item) || item.displayText === undefined) continue;
        const original = item.displayText;
        registry.unregister(id);
        registry.register({
            ...item,
            displayText: (scope: Blockly.ContextMenuRegistry.Scope) => withIcon(id, typeof original === "function" ? original(scope) : original),
        } as Blockly.ContextMenuRegistry.RegistryItem);
    }
}
