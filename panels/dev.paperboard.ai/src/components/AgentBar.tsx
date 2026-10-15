// The strip above the composer in a coding agent's chat: the project it
// works in, its mode, and what to do when it can't start or needs a sign-in.
// A Local AI chat whose model can call tools shows it too: there the project
// is optional, and the modes are Local AI's own (LOCAL_MODES).

import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import type { Connection } from "../core/providers";
import { LOCAL_MODES, localMode } from "../core/projectTools";
import { call, errorText, state } from "../lib/state";
import styles from "./AgentBar.module.css";

export interface AgentBarProps {
    /** a coding agent, or the Local AI connection a tool-calling model runs on */
    connection: Connection;
    /** unset while the chat is a draft: the project is kept here until the first message creates it */
    conversationId?: string;
    project?: string;
    mode?: string;
    generating: boolean;
    onDraftProject: (project: string | undefined) => void;
    onError: (text: string) => void;
}

export default function AgentBar(props: AgentBarProps) {
    const [choosing, setChoosing] = createSignal(false);
    const [busy, setBusy] = createSignal(false);
    const local = () => props.connection.kind !== "agent";
    const agent = () => (local() ? undefined : state.agents[props.connection.id]);
    const session = () => (props.conversationId && !local() ? state.agentSessions[props.conversationId] : undefined);
    // Local AI's modes only matter while its file tools are offered
    const modes = () => (local() ? (props.project ? LOCAL_MODES : []) : session()?.modes ?? []);
    const mode = () => (local() ? localMode(props.mode) : session()?.mode ?? props.mode);

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
                    aria-label={props.project ? `Project: ${props.project}. Change project` : "Choose a project"}
                    onClick={() => setChoosing(true)}
                >
                    <PaperIcon>folder</PaperIcon> {props.project ?? "Choose a project"}
                </PaperButton>
                <Show when={modes().length > 0}>
                    <div class={styles.mode}>
                        <PaperSelectMenu
                            name="agent-mode"
                            aria-label={local() ? "Approval mode" : "Agent mode"}
                            value={mode()}
                            disabled={busy() || !props.conversationId}
                            onValueChange={(v) => void setMode(String(v))}
                        >
                            <For each={modes()}>
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
            <ProjectModal
                open={choosing()}
                current={props.project}
                agentLabel={props.connection.label}
                optional={local()}
                onClose={() => setChoosing(false)}
                onChoose={async (project) => {
                    if (props.conversationId) {
                        await call(UI_ACTION_IDS.setConversationProject, { id: props.conversationId, project });
                    } else {
                        props.onDraftProject(project ?? undefined);
                    }
                    setChoosing(false);
                }}
            />
        </div>
    );
}

function ProjectModal(props: {
    open: boolean;
    current?: string;
    agentLabel: string;
    /** Local AI: a chat can leave its project and be a plain chat again */
    optional: boolean;
    onClose: () => void;
    /** null: no project */
    onChoose: (project: string | null) => Promise<void>;
}) {
    const [name, setName] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");

    const run = async (action: () => Promise<void>) => {
        setSaving(true);
        setError("");
        try {
            await action();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };
    const choose = (project: string) => run(() => props.onChoose(project));
    const create = () =>
        run(async () => {
            const created = await call<string>(UI_ACTION_IDS.createProject, { name: name() });
            setName("");
            await props.onChoose(created);
        });

    return (
        <PaperModal open={props.open} onClose={() => !saving() && props.onClose()} title="Choose a project" size="small">
            <PaperFlex direction="column" gap="full" fullWidth>
                <PaperText size={2}>
                    {props.optional
                        ? `In a project, ${props.agentLabel} can read the project's files, and change them or run commands there after you approve. Without one, it's a plain chat.`
                        : `${props.agentLabel} reads, edits and runs commands in the project's folder. Changing it starts a new session.`}
                </PaperText>
                <Show when={state.projects.length > 0}>
                    <PaperSelector name="agent-project" value={props.current} onValueChange={(v) => !saving() && void choose(String(v))}>
                        <For each={state.projects}>
                            {(p) => (
                                <PaperSelectorItem value={p} icon="folder" disabled={saving()}>
                                    {p}
                                </PaperSelectorItem>
                            )}
                        </For>
                    </PaperSelector>
                    <Show when={state.projectsTruncated}>
                        <PaperText size={1} color="text-muted">Not every project is listed.</PaperText>
                    </Show>
                </Show>
                <div class={styles.create}>
                    <PaperInput
                        fullWidth
                        label="New project"
                        icon="create_new_folder"
                        placeholder="my-app"
                        value={name()}
                        onInput={(e) => setName(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && name().trim()) void create();
                        }}
                    />
                    <PaperButton variant="primary" disabled={saving() || !name().trim()} onClick={() => void create()}>
                        <PaperIcon>add</PaperIcon> {saving() ? "Creating..." : "Create"}
                    </PaperButton>
                </div>
                <Show when={props.optional && props.current}>
                    <PaperButton variant="text" disabled={saving()} onClick={() => void run(() => props.onChoose(null))}>
                        <PaperIcon>folder_off</PaperIcon> Leave the project
                    </PaperButton>
                </Show>
                <Show when={error()}>
                    <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
