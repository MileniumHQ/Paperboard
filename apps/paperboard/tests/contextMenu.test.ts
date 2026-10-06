// Native text-field context menu contract (bun test): the pure template the
// main process pops up. Electron is not needed — the module only type-imports
// it, so the roles and enabled states are proven without a real window.
import { describe, expect, it } from "bun:test";
import {
    installTextEditContextMenu,
    textEditContextMenuTemplate,
} from "../src/main/contextMenu";

const flags = (overrides: Partial<Record<string, boolean>> = {}) => ({
    canUndo: true,
    canRedo: true,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canDelete: true,
    canSelectAll: true,
    ...overrides,
});

const roles = (template: ReturnType<typeof textEditContextMenuTemplate>) =>
    (template ?? []).map((item) => item.role ?? item.type);

describe("textEditContextMenuTemplate", () => {
    it("gives an editable field the full edit menu", () => {
        const template = textEditContextMenuTemplate({
            isEditable: true,
            selectionText: "hello",
            editFlags: flags(),
        });
        expect(roles(template)).toEqual([
            "undo",
            "redo",
            "separator",
            "cut",
            "copy",
            "paste",
            "pasteAndMatchStyle",
            "delete",
        ]);
        expect(template?.every((item) => item.enabled !== false)).toBe(true);
    });

    it("never offers selectAll: its role selects the whole panel, not the field", () => {
        const editable = textEditContextMenuTemplate({
            isEditable: true,
            selectionText: "",
            editFlags: flags(),
        });
        const selection = textEditContextMenuTemplate({
            isEditable: false,
            selectionText: "output",
            editFlags: flags(),
        });
        expect(roles(editable)).not.toContain("selectAll");
        expect(roles(selection)).not.toContain("selectAll");
    });

    it("disables actions the field cannot perform", () => {
        const template = textEditContextMenuTemplate({
            isEditable: true,
            selectionText: "",
            editFlags: flags({ canUndo: false, canRedo: false, canCut: false, canCopy: false, canDelete: false }),
        });
        const byRole = (role: string) => template?.find((item) => item.role === role);
        expect(byRole("undo")?.enabled).toBe(false);
        expect(byRole("redo")?.enabled).toBe(false);
        expect(byRole("cut")?.enabled).toBe(false);
        expect(byRole("copy")?.enabled).toBe(false);
        expect(byRole("delete")?.enabled).toBe(false);
        expect(byRole("paste")?.enabled).toBe(true);
    });

    it("offers copy for a non-editable selection, never edit actions", () => {
        const template = textEditContextMenuTemplate({
            isEditable: false,
            selectionText: "selectable",
            editFlags: flags({ canCut: false, canPaste: false, canDelete: false }),
        });
        expect(roles(template)).toEqual(["copy"]);
    });

    it("shows nothing for a right click with no text to act on", () => {
        expect(
            textEditContextMenuTemplate({
                isEditable: false,
                selectionText: "",
                editFlags: flags({ canCopy: false }),
            }),
        ).toBeNull();
        expect(
            textEditContextMenuTemplate({
                isEditable: false,
                selectionText: "text",
                editFlags: flags({ canCopy: false }),
            }),
        ).toBeNull();
    });
});

describe("installTextEditContextMenu", () => {
    const fakeContents = () => {
        let handler: ((event: unknown, params: unknown) => void) | undefined;
        return {
            contents: {
                on: (event: string, listener: (event: unknown, params: unknown) => void) => {
                    expect(event).toBe("context-menu");
                    handler = listener;
                },
            },
            fire: (params: unknown) => handler?.({}, params),
        };
    };

    it("pops the menu template for an editable field", () => {
        const { contents, fire } = fakeContents();
        const popped: unknown[] = [];
        installTextEditContextMenu(contents as never, (template) => popped.push(template));
        fire({ isEditable: true, selectionText: "", editFlags: flags() });
        expect(popped).toHaveLength(1);
        expect((popped[0] as { role?: string }[]).map((item) => item.role)).toContain("paste");
    });

    it("does not pop for a right click with no menu", () => {
        const { contents, fire } = fakeContents();
        let popped = 0;
        installTextEditContextMenu(contents as never, () => popped++);
        fire({
            isEditable: false,
            selectionText: "",
            editFlags: flags({ canCopy: false }),
        });
        expect(popped).toBe(0);
    });
});
