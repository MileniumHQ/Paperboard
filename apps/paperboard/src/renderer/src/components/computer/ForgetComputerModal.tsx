import { type Component, Show, createEffect, createSignal, on } from "solid-js";
import { createAction, PaperButton, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { logToMain, type ComputerInfo } from "../../lib/shell";

export interface ForgetComputerModalProps {
    /** the computer being forgotten; undefined closes the dialog */
    computer?: ComputerInfo;
    onClose: () => void;
    /** forgets it; a rejection keeps the dialog open, a toast saying why, and so does
     * an answer: why the computer couldn't be told, with nothing forgotten
     * unless `evenIfUntold` */
    onForget: (computerId: string, evenIfUntold: boolean) => Promise<string | null>;
}

// The one Forget Computer dialog, from the rail's menu, the can't-reach
// dialog and the computer's info page. Each opening starts clean.
const ForgetComputerModal: Component<ForgetComputerModalProps> = (props) => {
    const action = createAction();
    const forgetting = action.busy;
    // why the computer couldn't be told to forget this one; the next press
    // forgets it here anyway
    const [untold, setUntold] = createSignal<string | null>(null);

    createEffect(on(() => props.computer?.id, () => {
        setUntold(null);
    }));

    const close = () => {
        if (!forgetting()) props.onClose();
    };

    const forget = async () => {
        const computer = props.computer;
        if (!computer || forgetting()) return;
        await action.run("Couldn't forget this computer", async () => {
            try {
                const why = await props.onForget(computer.id, untold() !== null);
                if (why === null) props.onClose();
                else setUntold(why);
            } catch (err) {
                logToMain("error", "Failed to remove computer:", err);
                throw err;
            }
        });
    };

    return (
        <PaperModal
            open={Boolean(props.computer)}
            onClose={close}
            title={`Forget ${props.computer?.name ?? "this computer"}?`}
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={close} disabled={forgetting()}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="danger" disabled={forgetting()} onClick={() => void forget()}>
                        {forgetting() ? "Removing..." : untold() !== null ? "Forget Anyway" : "Forget Computer"}
                    </PaperButton>
                </>
            }
        >
            <PaperText preset="text">
                Are you sure you want to forget <strong>{props.computer?.name ?? "this computer"}</strong>? This will disconnect all panels on this machine.
            </PaperText>
            <Show when={untold()}>
                {(why) => (
                    <PaperQuote variant="warning" icon="warning" title={`${props.computer?.name ?? "That computer"} wasn't told`} role="alert">
                        Paperboard couldn't reach it to take back this computer's access: {why()}. If you forget it anyway, {props.computer?.name ?? "it"} keeps trusting this computer until you remove its access there.
                    </PaperQuote>
                )}
            </Show>
        </PaperModal>
    );
};

export default ForgetComputerModal;
