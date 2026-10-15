// A chat's mode picker. Turning on No sandbox asks first (unless the user
// said not to show it again); the switch itself is the service's
// setAgentMode, which is what makes the chat answer its own tool calls.

import { createSignal, For, Show } from "solid-js";
import { PaperButton, PaperCheckbox, PaperFlex, PaperModal, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { isNoSandboxMode } from "../core/permissionMode";
import type { AgentMode } from "../core/types";
import { call, errorText, setOpenMode, state } from "../lib/state";
import styles from "./ModeSelect.module.css";

export interface ModeSelectProps {
    /** unset while the chat is a draft: a mode needs a saved chat */
    conversationId?: string;
    modes: readonly AgentMode[];
    mode?: string;
    disabled?: boolean;
    /** who acts in this chat, for the warning ("Claude Code", "The AI") */
    actor: string;
    onError: (text: string) => void;
}

export default function ModeSelect(props: ModeSelectProps) {
    const [busy, setBusy] = createSignal(false);
    const [confirming, setConfirming] = createSignal<string>();
    const [dontShowAgain, setDontShowAgain] = createSignal(false);
    const [dialogError, setDialogError] = createSignal("");
    let wrapper: HTMLDivElement | undefined;

    const current = () => props.mode ?? props.modes[0]?.id;

    const apply = async (modeId: string) => {
        await call(UI_ACTION_IDS.setAgentMode, { id: props.conversationId, mode: modeId });
        setOpenMode(modeId);
    };

    // the option that opened the dialog is gone once it closes: focus goes back to the picker
    const returnFocus = () => requestAnimationFrame(() => wrapper?.querySelector<HTMLElement>("button")?.focus());

    const choose = async (modeId: string) => {
        if (modeId === current()) return;
        if (isNoSandboxMode(modeId) && state.settings.noSandboxWarning) {
            setDontShowAgain(false);
            setDialogError("");
            setConfirming(modeId);
            return;
        }
        setBusy(true);
        props.onError("");
        try {
            await apply(modeId);
        } catch (err) {
            props.onError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const cancel = () => {
        if (busy()) return;
        setConfirming(undefined);
        returnFocus();
    };

    const turnOn = async () => {
        const modeId = confirming();
        if (!modeId) return;
        setBusy(true);
        setDialogError("");
        try {
            await apply(modeId);
            if (dontShowAgain()) await call(UI_ACTION_IDS.updateSettings, { noSandboxWarning: false });
            setConfirming(undefined);
            returnFocus();
        } catch (err) {
            setDialogError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div class={styles.mode} ref={wrapper}>
            <PaperSelectMenu
                name="chat-mode"
                aria-label="Chat mode"
                value={current()}
                disabled={busy() || props.disabled || !props.conversationId}
                onValueChange={(v) => void choose(String(v))}
            >
                <For each={props.modes}>
                    {(m) => (
                        <PaperSelectMenuItem value={m.id} description={m.description}>
                            {m.name}
                        </PaperSelectMenuItem>
                    )}
                </For>
            </PaperSelectMenu>
            <PaperModal
                open={confirming() !== undefined}
                onClose={cancel}
                title="Turn on No sandbox?"
                size="small"
                footer={
                    <>
                        <PaperButton disabled={busy()} onClick={cancel}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" disabled={busy()} onClick={() => void turnOn()}>
                            {busy() ? "Turning on..." : "Turn on"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full" fullWidth>
                <PaperText>
                    {props.actor} will edit files and run commands without asking you first. Nothing stops a mistake before it happens, so only use it
                    when you trust the task. You can switch back at any time.
                </PaperText>
                <PaperCheckbox label="Do not show again" checked={dontShowAgain()} disabled={busy()} onChange={setDontShowAgain} />
                <Show when={dialogError()}>
                    <PaperText color="danger" role="alert">
                        {dialogError()}
                    </PaperText>
                </Show>
                </PaperFlex>
            </PaperModal>
        </div>
    );
}
