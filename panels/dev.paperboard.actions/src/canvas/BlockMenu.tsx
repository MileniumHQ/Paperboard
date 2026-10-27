// A block's context menu: run its flow, rename the value it produces, delete it.
import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperInput,
    PaperModal,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { blockVariableName, findBlock } from "../lib/tree";
import type { CanvasDocumentState } from "./document";

export default function BlockMenu(props: {
    doc: CanvasDocumentState;
    menu: ReturnType<typeof useContextMenuState>;
    blockId: string | null;
    onRun: (blockId: string, payload: any) => void;
}) {
    const block = () => (props.blockId ? findBlock(props.doc.blocks, props.blockId) : null);

    const [renameTargetId, setRenameTargetId] = createSignal<string | null>(null);
    const [renameDraft, setRenameDraft] = createSignal("");

    const openRename = (blockId: string) => {
        const target = findBlock(props.doc.blocks, blockId);
        if (!target) return;
        setRenameTargetId(blockId);
        setRenameDraft(blockVariableName(target) || "");
    };

    const confirmRename = () => {
        const id = renameTargetId();
        if (id) props.doc.renameVariable(id, renameDraft());
        setRenameTargetId(null);
    };

    return (
        <>
            <PaperContextMenu
                open={props.menu.isOpen()}
                target={props.menu.target()}
                placement={props.menu.placement()}
                onClose={props.menu.close}
            >
                <Show when={block()?.isTrigger}>
                    <PaperContextMenuItem
                        icon="play_arrow"
                        onClick={() => {
                            const b = block();
                            props.menu.close();
                            if (b) props.onRun(b.id, b.values?.output || b.values?.player || "TestPlayer");
                        }}
                    >
                        Run
                    </PaperContextMenuItem>
                </Show>
                <Show when={(() => {
                    const b = block();
                    return b && blockVariableName(b);
                })()}>
                    <PaperContextMenuItem
                        icon="edit"
                        onClick={() => {
                            const id = props.blockId;
                            props.menu.close();
                            if (id) openRename(id);
                        }}
                    >
                        Edit Name
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem
                    icon="delete"
                    danger
                    onClick={() => {
                        const id = props.blockId;
                        props.menu.close();
                        if (id) props.doc.deleteBlock(id);
                    }}
                >
                    Delete Block
                </PaperContextMenuItem>
            </PaperContextMenu>

            <PaperModal
                open={renameTargetId() !== null}
                onClose={() => setRenameTargetId(null)}
                title="Edit Name"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            variant="text"
                            onClick={() => setRenameTargetId(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="brand"
                            onClick={confirmRename}>
                            Save
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperInput
                    fullWidth
                    label="Variable name"
                    value={renameDraft()}
                    onInput={(e) => setRenameDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRename();
                    }}
                />
            </PaperModal>
        </>
    );
}
