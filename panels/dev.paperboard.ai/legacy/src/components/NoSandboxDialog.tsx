// The warning before a chat turns on No sandbox, unless the user said not to
// show it again. The switch itself is the service's setAgentMode, which is
// what makes the chat answer its own tool calls.

import { createSignal, Show } from "solid-js";
import { PaperButton, PaperCheckbox, PaperFlex, PaperModal, PaperText } from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { call, errorText } from "../lib/state";

export interface NoSandboxDialogProps {
    open: boolean;
    /** who acts in this chat ("Claude Code", "The AI") */
    actor: string;
    /** switches the chat's mode; a failure stays in the dialog */
    onTurnOn: () => Promise<void>;
    onClose: () => void;
}

export default function NoSandboxDialog(props: NoSandboxDialogProps) {
    const [busy, setBusy] = createSignal(false);
    const [dontShowAgain, setDontShowAgain] = createSignal(false);
    const [error, setError] = createSignal("");

    const close = () => {
        if (busy()) return;
        setDontShowAgain(false);
        setError("");
        props.onClose();
    };

    const turnOn = async () => {
        setBusy(true);
        setError("");
        try {
            await props.onTurnOn();
            if (dontShowAgain()) await call(UI_ACTION_IDS.updateSettings, { noSandboxWarning: false });
            setBusy(false);
            close();
        } catch (err) {
            setError(errorText(err));
            setBusy(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={close}
            title="Turn on No sandbox?"
            size="small"
            footer={
                <>
                    <PaperButton disabled={busy()} onClick={close}>
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
                    {props.actor} will edit files and run commands without asking you first. Nothing stops a mistake before it happens, so only use it when
                    you trust the task. You can switch back at any time.
                </PaperText>
                <PaperCheckbox label="Do not show again" checked={dontShowAgain()} disabled={busy()} onChange={setDontShowAgain} />
                <Show when={error()}>
                    <PaperText color="danger" role="alert">
                        {error()}
                    </PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
