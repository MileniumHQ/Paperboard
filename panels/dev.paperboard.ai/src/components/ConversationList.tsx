import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";
import type { ConversationSummary } from "../core/types";
import { state } from "../lib/state";
import styles from "./ConversationList.module.css";

/** List values that are controls, not chats; no conversation uses these ids. */
const NEW_CHAT = "__new-chat__";
const SETTINGS = "__settings__";

function when(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
    return new Date(ts).toLocaleDateString();
}

export interface ConversationListProps {
    selected: string | null;
    /** the settings view is the selected item instead of a chat */
    settingsOpen: boolean;
    onSelect: (id: string) => void;
    onNew: () => void;
    onRename: (id: string, title: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onOpenSettings: () => void;
}

/**
 * The chat list. Selecting "New chat" opens an empty draft instead of
 * creating a file; the conversation is only created when its first message
 * is sent, and that message's chat appears here selected.
 */
export default function ConversationList(props: ConversationListProps) {
    const menu = useContextMenuState();
    const [menuChat, setMenuChat] = createSignal<ConversationSummary | null>(null);
    const [renameTarget, setRenameTarget] = createSignal<ConversationSummary | null>(null);
    const [renameName, setRenameName] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [deleteTarget, setDeleteTarget] = createSignal<ConversationSummary | null>(null);
    const [deleting, setDeleting] = createSignal(false);

    const detail = (c: ConversationSummary): string => {
        const bits = [c.model || "No model", when(c.updatedAt)];
        if (state.approvals.some((a) => a.conversationId === c.id)) bits.push("needs approval");
        else if (state.generating.includes(c.id)) bits.push("replying");
        return bits.join(" · ");
    };

    const openMenu = (chat: ConversationSummary, e: MouseEvent) => {
        setMenuChat(chat);
        menu.openAtMouse(e);
    };

    const beginRename = () => {
        const chat = menuChat();
        if (!chat) return;
        setRenameName(chat.title);
        setRenameTarget(chat);
        menu.close();
    };

    const saveRename = async () => {
        const target = renameTarget();
        const name = renameName().trim();
        if (!target || !name) return;
        setSaving(true);
        try {
            await props.onRename(target.id, name);
            setRenameTarget(null);
        } catch {
            // the chat view reports the failure; keep the dialog open to retry
        } finally {
            setSaving(false);
        }
    };

    const beginDelete = () => {
        const chat = menuChat();
        if (!chat) return;
        setDeleteTarget(chat);
        menu.close();
    };

    const doDelete = async () => {
        const target = deleteTarget();
        if (!target) return;
        setDeleting(true);
        try {
            await props.onDelete(target.id);
            setDeleteTarget(null);
        } catch {
            // the chat view reports the failure; keep the dialog open to retry
        } finally {
            setDeleting(false);
        }
    };

    return (
        <nav class={styles.ConversationList} aria-label="Chats">
            <PaperList
                name="chatList"
                class={styles.list}
                borderless
                fullWidth
                fullHeight
                scrollable
                value={props.settingsOpen ? SETTINGS : props.selected ?? NEW_CHAT}
                onValueChange={(value) => {
                    if (value === NEW_CHAT) props.onNew();
                    else if (value === SETTINGS) props.onOpenSettings();
                    else props.onSelect(String(value));
                }}
            >
                <PaperListItem value={NEW_CHAT} icon="add">
                    New chat
                </PaperListItem>
                <For each={state.conversations}>
                    {(c) => (
                        <PaperListItem
                            value={c.id}
                            description={detail(c)}
                            onContextMenu={(e: MouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openMenu(c, e);
                            }}
                            actions={
                                <PaperButton
                                    icon
                                    size="tiny"
                                    variant="text"
                                    aria-label={`More actions for ${c.title}`}
                                    onPointerDown={(e: PointerEvent) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                    }}
                                    onClick={(e: MouseEvent) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        openMenu(c, e);
                                    }}
                                >
                                    more_vert
                                </PaperButton>
                            }
                        >
                            {c.title}
                        </PaperListItem>
                    )}
                </For>
                <PaperListItem value={SETTINGS} icon="settings" class={styles.settingsItem}>
                    Settings
                </PaperListItem>
            </PaperList>

            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuItem icon="edit" onClick={beginRename}>Edit name</PaperContextMenuItem>
                <PaperContextMenuItem icon="delete" danger onClick={beginDelete}>Delete</PaperContextMenuItem>
            </PaperContextMenu>

            <PaperModal
                open={renameTarget() !== null}
                onClose={() => !saving() && setRenameTarget(null)}
                title="Edit chat name"
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setRenameTarget(null)} disabled={saving()}>Cancel</PaperButton>
                        <PaperButton variant="primary" onClick={saveRename} disabled={saving() || !renameName().trim()}>Save</PaperButton>
                    </>
                }
            >
                <PaperInput
                    fullWidth
                    aria-label="Chat name"
                    value={renameName()}
                    ref={(el) => queueMicrotask(() => el.focus())}
                    onInput={(e) => setRenameName(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename();
                        if (e.key === "Escape") setRenameTarget(null);
                    }}
                />
            </PaperModal>

            <PaperModal
                open={deleteTarget() !== null}
                onClose={() => !deleting() && setDeleteTarget(null)}
                title="Delete this chat?"
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setDeleteTarget(null)} disabled={deleting()}>Keep it</PaperButton>
                        <PaperButton variant="danger" onClick={doDelete} disabled={deleting()}>Delete</PaperButton>
                    </>
                }
            >
                <PaperText>
                    "{deleteTarget()?.title}" and its messages are removed from this computer. This cannot be undone.
                </PaperText>
            </PaperModal>
        </nav>
    );
}
