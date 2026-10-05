import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperIcon,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { PROMPT_STYLE_DESCRIPTIONS, PROMPT_STYLE_LABELS, PROMPT_STYLES } from "../core/conversation";
import { call, errorText, state } from "../lib/state";
import styles from "./SettingsView.module.css";

const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072];

export default function SettingsView() {
    const [error, setError] = createSignal("");
    const [confirmingDeleteAll, setConfirmingDeleteAll] = createSignal(false);
    const [deletingAll, setDeletingAll] = createSignal(false);

    const save = async (patch: Record<string, unknown>) => {
        setError("");
        try {
            await call(UI_ACTION_IDS.updateSettings, patch);
        } catch (err) {
            setError(errorText(err));
        }
    };

    const deleteAllChats = async () => {
        setDeletingAll(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.deleteAllConversations);
            setConfirmingDeleteAll(false);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setDeletingAll(false);
        }
    };

    return (
        <div class={styles.SettingsView}>
            <Show when={state.storageError}>
                <PaperText color="warning" role="status">
                    {state.storageError}
                </PaperText>
            </Show>
            <Show when={error()}>
                <PaperText color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Personality"
                    description="How the assistant talks, in every chat."
                >
                    <PaperSelectMenu
                        name="promptStyle"
                        aria-label="Personality"
                        value={state.settings.promptStyle}
                        onValueChange={(value) =>
                            void save({ promptStyle: value })
                        }
                    >
                        {PROMPT_STYLES.map((style) => (
                            <PaperSelectMenuItem
                                value={style}
                                description={PROMPT_STYLE_DESCRIPTIONS[style]}
                            >
                                {PROMPT_STYLE_LABELS[style]}
                            </PaperSelectMenuItem>
                        ))}
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem
                    title="Web search"
                    description="Lets the model search the web through DuckDuckGo when it needs something current. Searches run without asking, and each one shows in the chat."
                >
                    <PaperToggle
                        name="webSearch"
                        aria-label="Web search"
                        checked={state.settings.webSearch}
                        onChange={(on) => void save({ webSearch: on })}
                    />
                </PaperSettingItem>
                <PaperSettingItem
                    title="Shell commands"
                    description="Lets the model run commands on this computer. You approve every command before it runs; there is no always-allow."
                >
                    <PaperToggle
                        name="shellCommands"
                        aria-label="Shell commands"
                        checked={state.settings.shellCommands}
                        onChange={(on) => void save({ shellCommands: on })}
                    />
                </PaperSettingItem>
                <PaperSettingItem
                    title="App actions"
                    description="Tells the model about your other panels' actions so it can ask to use them. Each use still needs your approval. Experimental."
                >
                    <PaperToggle
                        name="panelActions"
                        aria-label="App actions"
                        checked={state.settings.panelActions}
                        onChange={(on) => void save({ panelActions: on })}
                    />
                </PaperSettingItem>
                <PaperSettingItem
                    title="Context length"
                    description="How much of a chat the model reads at once. Longer contexts remember more but need more memory, which the fit ratings include."
                >
                    <PaperSelectMenu
                        name="contextLength"
                        aria-label="Context length"
                        value={String(state.settings.contextLength)}
                        onValueChange={(value) =>
                            void save({ contextLength: Number(value) })
                        }
                    >
                        {CONTEXTS.map((n) => (
                            <PaperSelectMenuItem
                                value={String(n)}
                            >{`${n / 1024}K tokens`}</PaperSelectMenuItem>
                        ))}
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem
                    title="Delete all chats"
                    description="Removes every chat and its messages from this computer. This cannot be undone."
                >
                    <PaperButton
                        variant="danger"
                        onClick={() => setConfirmingDeleteAll(true)}
                    >
                        <PaperIcon>delete</PaperIcon> Delete all
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal
                open={confirmingDeleteAll()}
                onClose={() => !deletingAll() && setConfirmingDeleteAll(false)}
                title="Delete all chats?"
                size="small"
                footer={
                    <>
                        <PaperButton
                            onClick={() => setConfirmingDeleteAll(false)}
                            disabled={deletingAll()}
                        >
                            Keep them
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={deleteAllChats}
                            disabled={deletingAll()}
                        >
                            Delete all
                        </PaperButton>
                    </>
                }
            >
                <PaperText>
                    Every chat and its messages are removed from this computer. This cannot be undone.
                </PaperText>
            </PaperModal>
        </div>
    );
}
