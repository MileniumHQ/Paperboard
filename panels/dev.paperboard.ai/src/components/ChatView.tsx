import { createEffect, createMemo, createSignal, Index, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperText } from "@mileniumhq/paperui";
import { actionsApi } from "@mileniumhq/paperapi";
import { UI_ACTION_IDS } from "../contract";
import { OLLAMA_PROVIDER_ID, providerLabel } from "../core/providers";
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
import Composer from "./Composer";
import ConversationList from "./ConversationList";
import { groupTurns, type Turn } from "../core/chain";
import { createChatSelection } from "../lib/selection";
import { AssistantTurn, UserMessage } from "./MessageView";
import ModelsModal from "./ModelsModal";
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
    let scroller: HTMLDivElement | undefined;
    let thread: HTMLDivElement | undefined;
    let stickToBottom = true;

    onMount(() => {
        const off = subscribeChatEvents();
        void loadPanelInfo();
        const offRegistry = actionsApi.onRegistryChange(() => void loadPanelInfo());
        onCleanup(() => {
            off();
            offRegistry();
        });
    });

    // the reader stays pinned to the newest message; any upward scroll lets go
    onMount(() => {
        const pin = () => {
            if (stickToBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
        };
        const observer = new ResizeObserver(pin);
        if (scroller) observer.observe(scroller);
        if (thread) observer.observe(thread);
        onCleanup(() => observer.disconnect());
    });

    // the open conversation's title follows the saved summary, so the auto
    // title from the first message shows up without re-opening the chat
    createEffect(() => {
        const c = openConversation();
        if (!c) return;
        const summary = state.conversations.find((s) => s.id === c.id);
        if (summary && summary.title !== c.title) renameOpen(summary.title);
    });

    createEffect(
        on(selected, (id) => {
            stickToBottom = true;
            void openChat(id).then(() => {
                requestAnimationFrame(() => {
                    if (stickToBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
                });
            });
        }),
    );

    const conversation = () => openConversation();
    const turns = createMemo(() => groupTurns(conversation()?.messages ?? []));
    const model = () => conversation()?.model || state.settings.defaultModel || state.models[0]?.name || "";
    const installed = createMemo(() => state.models.find((m) => m.name === model()));
    const generating = () => Boolean(conversation() && state.generating.includes(conversation()!.id));
    const waitingHere = () => state.approvals.filter((a) => a.conversationId === conversation()?.id).length;
    const usingOllama = () => state.provider.id === OLLAMA_PROVIDER_ID;

    const disabledReason = (): string | undefined => {
        // a URL endpoint has no local runtime to wait for; if it is down the
        // send fails with the endpoint's own error
        if (usingOllama() && state.runtime.status !== "ready") return `${providerLabel(state.provider.id)} is not running.`;
        if (!model()) return "Choose a model for this chat.";
        if (!installed()) return `${model()} is not downloaded. Pick one from Models.`;
        return undefined;
    };

    const runtimeNotice = (): { text: string; action?: boolean } | null => {
        if (!usingOllama()) return null;
        const label = providerLabel(state.provider.id);
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
                const c = await call<Conversation>(UI_ACTION_IDS.newConversation, { model: model() });
                // hold the selection before the draft flag drops: the summary
                // event may still be travelling when this call's answer lands
                selection.created(c.id);
                await openChat(c.id);
                id = c.id;
            }
            stickToBottom = true;
            await call(UI_ACTION_IDS.sendMessage, { id, text, reasoning, attachments });
            return true;
        } catch (err) {
            setError(errorText(err));
            return false;
        }
    };

    const changeModel = async (next: string) => {
        setError("");
        try {
            const c = conversation();
            if (c) {
                await call(UI_ACTION_IDS.setConversationModel, { id: c.id, model: next });
                setOpenModel(next);
            } else {
                await call(UI_ACTION_IDS.updateSettings, { defaultModel: next });
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
                <Show when={!settingsOpen()} fallback={<div class={styles.settingsView}><SettingsTab /></div>}>
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
                    ref={scroller}
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                    }}
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
                                title="Ask anything"
                                description={
                                    usingOllama()
                                        ? "Replies are generated on this computer. Web searches are the only thing sent out, and only when the model searches."
                                        : "Replies come from the endpoint you configured."
                                }
                            />
                            <Show when={state.models.length === 0}>
                                <PaperButton variant="primary" onClick={() => setModelsOpen(true)}>
                                    <PaperIcon>download</PaperIcon> Download a model
                                </PaperButton>
                            </Show>
                        </div>
                    </Show>
                    <div class={styles.thread} ref={thread}>
                        {/* by position: turns only append, so a streaming reply updates in place */}
                        <Index each={turns()}>
                            {(turn) => (
                                <Switch>
                                    <Match when={turn().kind === "user" && turn()}>
                                        {(t) => <UserMessage message={(t() as Extract<Turn, { kind: "user" }>).message} />}
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
                                    <PaperIcon>play_arrow</PaperIcon> Start {providerLabel(state.provider.id)}
                                </PaperButton>
                            </Show>
                        </div>
                    )}
                </Show>
                <Composer
                    disabled={Boolean(disabledReason())}
                    disabledReason={disabledReason()}
                    generating={generating()}
                    canThink={Boolean(installed()?.capabilities.includes("thinking"))}
                    model={model()}
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
                onPick={(ref) => {
                    setModelsOpen(false);
                    void changeModel(ref);
                }}
            />
        </div>
    );
}
