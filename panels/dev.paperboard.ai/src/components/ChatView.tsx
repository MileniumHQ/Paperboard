import { createEffect, createMemo, createSignal, Index, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperPage, PaperText } from "@mileniumhq/paperui";
import { actionsApi } from "@mileniumhq/paperapi";
import { UI_ACTION_IDS } from "../contract";
import { connectionLabel, OLLAMA_PROVIDER, OLLAMA_PROVIDER_ID, unlistedModelReason } from "../core/providers";
import type { ReasoningLevel } from "../core/reasoning";
import type { Attachment, Conversation } from "../core/types";
import {
    call,
    errorText,
    openChat,
    openConversation,
    openError,
    renameOpen,
    setOpenModel,
    state,
    subscribeChatEvents,
} from "../lib/state";
import { loadPanelInfo } from "../lib/panels";
import { createStickToBottom } from "../lib/stickToBottom";
import Composer from "./Composer";
import ConversationList from "./ConversationList";
import { groupTurns, type Turn } from "../core/chain";
import { createChatSelection } from "../lib/selection";
import { AssistantTurn, UserMessage } from "./MessageView";
import ModelsModal from "./ModelsModal";
import AgentBar from "./AgentBar";
import ModeSelect from "./ModeSelect";
import { LOCAL_MODES } from "../core/permissionMode";
import SettingsTab from "./SettingsTab";
import styles from "./ChatView.module.css";

export default function ChatView() {
    // the selection machine holds a freshly created chat through the window
    // where its summary event is still in flight (see core/selection.ts)
    const selection = createChatSelection(() => state.conversations.map((c) => c.id));
    const selected = selection.selected;
    const draft = selection.draft;
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    const [error, setError] = createSignal("");
    const [modelsOpen, setModelsOpen] = createSignal(false);
    const [starting, setStarting] = createSignal(false);
    // a draft agent chat's project, applied when the first message creates the chat
    const [draftProject, setDraftProject] = createSignal<string>();
    const scroll = createStickToBottom();

    onMount(() => {
        const off = subscribeChatEvents();
        void loadPanelInfo();
        const offRegistry = actionsApi.onRegistryChange(() => void loadPanelInfo());
        onCleanup(() => {
            off();
            offRegistry();
        });
    });

    // the open conversation's title and model follow the saved summary, so
    // the auto title from the first message, and a rename or model switch
    // made in another window, show up without re-opening the chat
    createEffect(() => {
        const c = openConversation();
        if (!c) return;
        const summary = state.conversations.find((s) => s.id === c.id);
        if (summary && summary.title !== c.title) renameOpen(summary.title);
        if (summary && summary.model !== c.model) setOpenModel(summary.model);
    });

    createEffect(
        on(selected, (id) => {
            scroll.stick();
            void openChat(id).then(() => {
                requestAnimationFrame(scroll.pin);
            });
        }),
    );

    // a chat started from Home (Quick ask) opens here; one window takes it
    createEffect(
        on(
            () => state.openRequest,
            (request) => {
                if (!request) return;
                void call<string | null>(UI_ACTION_IDS.takeOpenRequest)
                    .then((id) => {
                        if (!id) return;
                        setSettingsOpen(false);
                        selection.created(id);
                    })
                    .catch((err) => setError(errorText(err)));
            },
        ),
    );

    const conversation = () => openConversation();
    const turns = createMemo(() => groupTurns(conversation()?.messages ?? []));
    const model = () => conversation()?.model || state.settings.defaultModel || state.models[0]?.name || "";
    // the chat's connection; a chat without one runs on the default's, else the first that lists the name
    const chatProvider = () => {
        const c = conversation();
        if (c?.provider) return c.provider;
        return !c?.model && state.settings.defaultProvider ? state.settings.defaultProvider : undefined;
    };
    const installed = createMemo(() => {
        const via = chatProvider();
        const listed = state.models.find((m) => m.name === model() && (!via || m.provider === via));
        // an agent chat made before the agent listed its models names the agent; it runs on the agent's own default
        if (!listed && via && state.connections.some((c) => c.id === via && c.kind === "agent")) return state.models.find((m) => m.provider === via);
        return listed;
    });
    /** the chat's model as its provider names it ("opus" is "Opus 5.5") */
    const modelName = () => {
        const m = installed();
        return m && m.name === model() ? (m.label ?? m.name) : model();
    };
    const agentConnection = () => {
        const via = installed()?.provider ?? chatProvider();
        return state.connections.find((c) => c.id === via && c.kind === "agent");
    };
    // a local model's chat has a mode once it can run actions or commands
    const localTools = () => Boolean(installed()?.capabilities.includes("tools")) && (state.settings.shellCommands || state.settings.panelActions);
    const summary = () => state.conversations.find((s) => s.id === conversation()?.id);
    const lastProject = () => (state.lastProject && state.projects.includes(state.lastProject) ? state.lastProject : undefined);
    const project = () => (conversation() ? summary()?.project ?? conversation()?.project : draftProject() ?? lastProject());
    const generating = () => Boolean(conversation() && state.generating.includes(conversation()!.id));
    const waitingHere = () => state.approvals.filter((a) => a.conversationId === conversation()?.id).length;
    const hasOllama = () => state.connections.some((c) => c.kind === "ollama");
    // Ollama's runtime matters when this chat's model is Ollama's, or when
    // nothing is listed yet and Ollama is what would list it
    const usingOllama = () => {
        const via = installed()?.provider ?? chatProvider();
        return via ? via === OLLAMA_PROVIDER_ID : hasOllama();
    };

    const disabledReason = (): string | undefined => {
        // a URL endpoint has no local runtime to wait for; if it is down the
        // send fails with the endpoint's own error
        if (usingOllama() && state.runtime.status !== "ready") return `${OLLAMA_PROVIDER.label} is not running.`;
        if (!model()) return "Choose a model for this chat.";
        if (!installed()) return unlistedModelReason(state.connections, model(), chatProvider());
        if (agentConnection() && !project()) return `Choose a project for ${agentConnection()!.label} to work in.`;
        return undefined;
    };

    const runtimeNotice = (): { text: string; action?: boolean } | null => {
        if (!usingOllama()) return null;
        const label = OLLAMA_PROVIDER.label;
        switch (state.runtime.status) {
            case "ready":
                return null;
            case "starting":
                return { text: `Starting ${label}…` };
            case "installing":
                return { text: `Installing ${label}…` };
            case "stopped":
                return { text: `${label} is not running.`, action: true };
            case "error":
                return { text: state.runtime.error || `${label} stopped unexpectedly.`, action: true };
            case "missing":
                return { text: `${label} is not installed.` };
            default:
                return { text: `Checking ${label}…` };
        }
    };

    const startRuntime = async () => {
        setStarting(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.startRuntime);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setStarting(false);
        }
    };

    const newChat = () => {
        setError("");
        setSettingsOpen(false);
        setDraftProject(undefined);
        selection.newChat();
    };

    const selectChat = (id: string) => {
        setSettingsOpen(false);
        selection.select(id);
    };

    const send = async (text: string, reasoning: ReasoningLevel, attachments: Attachment[]): Promise<boolean> => {
        setError("");
        let id = conversation()?.id;
        try {
            if (!id) {
                const provider = installed()?.provider ?? chatProvider();
                const c = await call<Conversation>(UI_ACTION_IDS.newConversation, { model: model(), ...(provider ? { provider } : {}) });
                // hold the selection before the draft flag drops: the summary
                // event may still be travelling when this call's answer lands
                selection.created(c.id);
                await openChat(c.id);
                id = c.id;
                const chosen = draftProject();
                setDraftProject(undefined);
                if (agentConnection() && chosen && chosen !== c.project) await call(UI_ACTION_IDS.setConversationProject, { id, project: chosen });
            }
            scroll.stick();
            await call(UI_ACTION_IDS.sendMessage, { id, text, reasoning, attachments });
            return true;
        } catch (err) {
            setError(errorText(err));
            return false;
        }
    };

    const changeModel = async (next: string, provider: string) => {
        setError("");
        try {
            const c = conversation();
            if (c) {
                await call(UI_ACTION_IDS.setConversationModel, { id: c.id, model: next, provider });
                setOpenModel(next, provider);
            } else {
                await call(UI_ACTION_IDS.updateSettings, { defaultModel: next, defaultProvider: provider });
            }
        } catch (err) {
            setError(errorText(err));
        }
    };

    const rename = async (id: string, title: string) => {
        try {
            await call(UI_ACTION_IDS.renameConversation, { id, title });
        } catch (err) {
            setError(errorText(err));
            throw err;
        }
    };

    const remove = async (id: string) => {
        try {
            await call(UI_ACTION_IDS.deleteConversation, { id });
        } catch (err) {
            setError(errorText(err));
            throw err;
        }
    };

    return (
        <div class={styles.ChatView}>
            <ConversationList
                selected={selected()}
                settingsOpen={settingsOpen()}
                onSelect={selectChat}
                onNew={newChat}
                onRename={rename}
                onDelete={remove}
                onOpenSettings={() => setSettingsOpen(true)}
            />
            <section class={styles.main} aria-label={settingsOpen() ? "Settings" : "Conversation"}>
                <Show when={!settingsOpen()} fallback={<div class={styles.settingsView}><PaperPage><SettingsTab onManageProviders={() => setModelsOpen(true)} /></PaperPage></div>}>
                <Show when={waitingHere() > 0}>
                    <div class={styles.approvalBanner} role="status">
                        <PaperIcon>front_hand</PaperIcon>
                        <PaperText size={2} weight={600}>
                            The AI is waiting for you to approve {waitingHere() === 1 ? "an action" : `${waitingHere()} actions`}.
                        </PaperText>
                    </div>
                </Show>

                <div
                    class={styles.messages}
                    ref={scroll.scrollerRef}
                >
                    <Show when={openError()}>
                        <div class={styles.welcome}>
                            <PaperEmptyState icon="error" title="This chat could not be opened" description={openError()} />
                            <Show when={selected()}>
                                <PaperButton variant="primary" onClick={() => void openChat(selected())}>
                                    <PaperIcon>refresh</PaperIcon> Try again
                                </PaperButton>
                            </Show>
                        </div>
                    </Show>
                    <Show when={!openError() && (conversation()?.messages.length ?? 0) === 0}>
                        <div class={styles.welcome}>
                            <PaperEmptyState
                                icon="smart_toy"
                                title={agentConnection() ? `Work with ${agentConnection()!.label}` : "Ask anything"}
                                description={
                                    agentConnection()
                                        ? `${agentConnection()!.label} reads, edits and runs commands in the project below, asking before it changes things.`
                                        : usingOllama()
                                        ? "Replies are generated on this computer."
                                        : `Replies come from ${connectionLabel(state.connections, installed()?.provider ?? chatProvider())}.`
                                }
                            />
                            <Show when={state.models.length === 0}>
                                <PaperButton variant="primary" onClick={() => setModelsOpen(true)}>
                                    <PaperIcon>download</PaperIcon> Download a model
                                </PaperButton>
                            </Show>
                        </div>
                    </Show>
                    <div class={styles.thread} ref={scroll.contentRef}>
                        {/* by position: turns only append, so a streaming reply updates in place */}
                        <Index each={turns()}>
                            {(turn) => (
                                <Switch>
                                    <Match when={turn().kind === "user" && turn()}>
                                        {(t) => <UserMessage message={(t() as Extract<Turn, { kind: "user" }>).message} agent={agentConnection()?.label} />}
                                    </Match>
                                    <Match when={turn().kind === "assistant" && turn()}>
                                        {(t) => <AssistantTurn rounds={(t() as Extract<Turn, { kind: "assistant" }>).rounds} />}
                                    </Match>
                                </Switch>
                            )}
                        </Index>
                    </div>
                </div>

                <Show when={error()}>
                    <div class={styles.error} role="alert">
                        <PaperText size={2} color="danger">{error()}</PaperText>
                        <PaperButton icon size="tiny" variant="text" aria-label="Dismiss error" onClick={() => setError("")}>
                            close
                        </PaperButton>
                    </div>
                </Show>
                <Show when={runtimeNotice()}>
                    {(notice) => (
                        <div class={styles.runtimeRow} role="status">
                            <PaperText size={2} color="text-muted">{notice().text}</PaperText>
                            <Show when={notice().action}>
                                <PaperButton size="small" disabled={starting()} onClick={() => void startRuntime()}>
                                    <PaperIcon>play_arrow</PaperIcon> Start {OLLAMA_PROVIDER.label}
                                </PaperButton>
                            </Show>
                        </div>
                    )}
                </Show>
                <Composer
                    toolbar={
                        <Show
                            when={agentConnection()}
                            fallback={
                                <Show when={localTools()}>
                                    <ModeSelect conversationId={conversation()?.id} modes={LOCAL_MODES} mode={conversation()?.mode} actor="The AI" onError={setError} />
                                </Show>
                            }
                        >
                            {(agent) => (
                                <AgentBar
                                    connection={agent()}
                                    conversationId={conversation()?.id}
                                    project={project()}
                                    mode={conversation()?.mode}
                                    generating={generating()}
                                    onDraftProject={setDraftProject}
                                    onError={setError}
                                />
                            )}
                        </Show>
                    }
                    commands={conversation() ? state.agentSessions[conversation()!.id]?.commands : undefined}
                    placeholder={agentConnection() ? `Tell ${agentConnection()!.label} what to do` : undefined}
                    disabled={Boolean(disabledReason())}
                    disabledReason={disabledReason()}
                    generating={generating()}
                    canThink={Boolean(installed()?.capabilities.includes("thinking"))}
                    model={modelName()}
                    agent={agentConnection()?.agent}
                    modelReady={Boolean(installed())}
                    reasoning={state.settings.reasoning}
                    onOpenModels={() => setModelsOpen(true)}
                    onReasoningChange={(level) =>
                        void call(UI_ACTION_IDS.updateSettings, { reasoning: level }).catch((err) => setError(errorText(err)))
                    }
                    onSend={send}
                    onStop={() => conversation() && void call(UI_ACTION_IDS.stopGeneration, { id: conversation()!.id }).catch((err) => setError(errorText(err)))}
                />
                </Show>
            </section>

            <ModelsModal
                open={modelsOpen()}
                onClose={() => setModelsOpen(false)}
                // the picker opens on the provider this chat runs on
                initialPane={installed()?.provider ?? chatProvider()}
                onPick={(ref, provider) => {
                    setModelsOpen(false);
                    void changeModel(ref, provider);
                }}
            />
        </div>
    );
}
