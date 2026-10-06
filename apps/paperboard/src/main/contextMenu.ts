import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from "electron";

/**
 * Native menu for a right-clicked text field. Electron has no default context
 * menu, so without this a right click on an input does nothing. Returns null
 * when the click has nothing to offer (so custom DOM menus on non-text UI are
 * left alone).
 *
 * There is deliberately no `selectAll` item. Its role runs against the panel's
 * frame, not the focused field, so on a panel it selects the entire document
 * instead of the field — Ctrl/Cmd+A still selects within a focused field.
 */
export function textEditContextMenuTemplate(
    params: Pick<ContextMenuParams, "isEditable" | "selectionText" | "editFlags">,
): MenuItemConstructorOptions[] | null {
    const flags = params.editFlags;

    if (params.isEditable) {
        return [
            { role: "undo", enabled: flags.canUndo },
            { role: "redo", enabled: flags.canRedo },
            { type: "separator" },
            { role: "cut", enabled: flags.canCut },
            { role: "copy", enabled: flags.canCopy },
            { role: "paste", enabled: flags.canPaste },
            { role: "pasteAndMatchStyle", enabled: flags.canPaste },
            { role: "delete", enabled: flags.canDelete },
        ];
    }

    if (params.selectionText.length > 0 && flags.canCopy) {
        return [{ role: "copy" }];
    }

    return null;
}

/**
 * Wires the webContents `context-menu` event to a popup, but only when
 * `textEditContextMenuTemplate` has a menu to show. The popup is injected so
 * the event-to-popup boundary is testable without a real window.
 */
export function installTextEditContextMenu(
    contents: Pick<WebContents, "on">,
    popup: (template: MenuItemConstructorOptions[]) => void,
): void {
    contents.on("context-menu", (_event, params) => {
        const template = textEditContextMenuTemplate(params);
        if (!template) return;
        popup(template);
    });
}
