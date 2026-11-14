import { type Component, Show, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperModal, PaperText } from "@mileniumhq/paperui";
import { logToMain, type ComputerInfo } from "../../lib/shell";
import { errorMessage } from "../../lib/errorMessage";

export interface ForgetComputerModalProps {
    /** the computer being forgotten; undefined closes the dialog */
    computer?: ComputerInfo;
    onClose: () => void;
    /** forgets it; a rejection keeps the dialog open with why */
    onForget: (computerId: string) => Promise<void>;
}

// The one Forget Computer dialog, from the rail's menu, the can't-reach
// dialog and the computer's info page. Each opening starts clean.
const ForgetComputerModal: Component<ForgetComputerModalProps> = (props) => {
    const [forgetting, setForgetting] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    createEffect(on(() => props.computer?.id, () => setError(null)));

    const close = () => {
        if (!forgetting()) props.onClose();
    };

    const forget = async () => {
        const computer = props.computer;
        if (!computer || forgetting()) return;
        setForgetting(true);
        setError(null);
        try {
            await props.onForget(computer.id);
            props.onClose();
        } catch (err) {
            logToMain("error", "Failed to remove computer:", err);
            setError(`Couldn't forget this computer: ${errorMessage(err)}`);
        } finally {
            setForgetting(false);
        }
    };

    return (
        <PaperModal
            open={Boolean(props.computer)}
            onClose={close}
            title="Forget Computer"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={close} disabled={forgetting()}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" disabled={forgetting()} onClick={() => void forget()}>
                        {forgetting() ? "Removing..." : "Forget Computer"}
                    </PaperButton>
                </>
            }
        >
            <PaperText preset="text">
                Are you sure you want to forget <strong>{props.computer?.name ?? "this computer"}</strong>? This will disconnect all panels on this machine.
            </PaperText>
            <Show when={error()}>
                <PaperText preset="error">{error()}</PaperText>
            </Show>
        </PaperModal>
    );
};

export default ForgetComputerModal;
