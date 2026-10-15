// The strip above the composer in a coding agent's chat: the folder it works
// in, its mode, and what to do when it can't start or needs a sign-in.

import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import type { Connection } from "../core/providers";
import { call, errorText, state } from "../lib/state";
import styles from "./AgentBar.module.css";

export interface AgentBarProps {
    connection: Connection;
    /** unset while the chat is a draft: the folder is kept here until the first message creates it */
    conversationId?: string;
    folder?: string;
    mode?: string;
    generating: boolean;
    onDraftFolder: (folder: string) => void;
    onError: (text: string) => void;
}

function folderName(folder: string): string {
    return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
}

export default function AgentBar(props: AgentBarProps) {
    const [choosing, setChoosing] = createSignal(false);
    const [busy, setBusy] = createSignal(false);
    const agent = () => state.agents[props.connection.id];
    const session = () => (props.conversationId ? state.agentSessions[props.conversationId] : undefined);
    const mode = () => session()?.mode ?? props.mode;

    const act = async (action: () => Promise<unknown>) => {
        setBusy(true);
        props.onError("");
        try {
            await action();
        } catch (err) {
            props.onError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const setMode = (modeId: string) =>
        act(() => call(UI_ACTION_IDS.setAgentMode, { id: props.conversationId, mode: modeId }));

    return (
        <div class={styles.bar}>
            <Show when={agent()?.status === "auth-required"}>
                <div class={styles.notice} role="status">
                    <PaperIcon>key</PaperIcon>
                    <PaperText size={2}>{props.connection.label} needs you to sign in.</PaperText>
                    <For each={agent()?.authMethods ?? []} fallback={<PaperText size={2} color="text-muted">Sign in with its own command in a terminal, then send again.</PaperText>}>
                        {(m) => (
                            <PaperButton size="small" title={m.description} disabled={busy()} onClick={() => void act(() => call(UI_ACTION_IDS.authenticateAgent, { id: props.connection.id, methodId: m.id }))}>
                                {m.name}
                            </PaperButton>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={agent()?.status === "error"}>
                <div class={styles.notice} role="status">
                    <PaperIcon>error</PaperIcon>
                    <PaperText size={2} truncate title={agent()?.errorDetail}>{agent()?.error ?? `${props.connection.label} stopped.`}</PaperText>
                    <PaperButton size="small" disabled={busy()} onClick={() => void act(() => call(UI_ACTION_IDS.checkAgent, { id: props.connection.id }))}>
                        <PaperIcon>refresh</PaperIcon> Try again
                    </PaperButton>
                </div>
            </Show>
            <div class={styles.row}>
                <PaperButton
                    size="small"
                    variant="text"
                    disabled={props.generating}
                    title={props.folder ? `${props.connection.label} works in ${props.folder}` : undefined}
                    aria-label={props.folder ? `Folder: ${props.folder}. Change folder` : "Choose a folder"}
                    onClick={() => setChoosing(true)}
                >
                    <PaperIcon>folder</PaperIcon> {props.folder ? folderName(props.folder) : "Choose a folder"}
                </PaperButton>
                <Show when={(session()?.modes.length ?? 0) > 0}>
                    <div class={styles.mode}>
                        <PaperSelectMenu
                            name="agent-mode"
                            aria-label="Agent mode"
                            value={mode()}
                            disabled={busy() || !props.conversationId}
                            onValueChange={(v) => void setMode(String(v))}
                        >
                            <For each={session()?.modes}>
                                {(m) => (
                                    <PaperSelectMenuItem value={m.id} description={m.description}>
                                        {m.name}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                    </div>
                </Show>
            </div>
            <FolderModal
                open={choosing()}
                current={props.folder}
                agentLabel={props.connection.label}
                onClose={() => setChoosing(false)}
                onChoose={async (folder) => {
                    if (props.conversationId) {
                        await call(UI_ACTION_IDS.setConversationFolder, { id: props.conversationId, folder });
                    } else {
                        props.onDraftFolder(folder);
                    }
                    setChoosing(false);
                }}
            />
        </div>
    );
}

function FolderModal(props: {
    open: boolean;
    current?: string;
    agentLabel: string;
    onClose: () => void;
    onChoose: (folder: string) => Promise<void>;
}) {
    const [path, setPath] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");

    const choose = async (folder: string) => {
        setSaving(true);
        setError("");
        try {
            await props.onChoose(folder);
            setPath("");
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={() => !saving() && props.onClose()}
            title="Choose a folder"
            size="small"
            footer={
                <>
                    <PaperButton onClick={props.onClose} disabled={saving()}>Cancel</PaperButton>
                    <PaperButton variant="primary" disabled={saving() || !path().trim()} onClick={() => void choose(path())}>
                        {saving() ? "Checking..." : "Use this folder"}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperText size={2}>
                    {props.agentLabel} reads, edits and runs commands in this folder on this computer. Changing it starts a new session.
                </PaperText>
                <PaperInput
                    fullWidth
                    label="Folder"
                    icon="folder"
                    placeholder={props.current ?? "~/projects/my-app"}
                    value={path()}
                    onInput={(e) => setPath(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && path().trim()) void choose(path());
                    }}
                />
                <Show when={state.recentFolders.length > 0}>
                    <PaperText preset="label">Recent</PaperText>
                    <div class={styles.recents}>
                        <For each={state.recentFolders}>
                            {(f) => (
                                <PaperButton size="small" variant="text" disabled={saving()} title={f} onClick={() => void choose(f)}>
                                    <PaperIcon>{f === props.current ? "folder_open" : "folder"}</PaperIcon> {f}
                                </PaperButton>
                            )}
                        </For>
                    </div>
                </Show>
                <Show when={error()}>
                    <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
