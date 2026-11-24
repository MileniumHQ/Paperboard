import { batch, createSignal } from "solid-js";
import { PaperButton, PaperEffect, PaperFlex, PaperInput, PaperModal, PaperText, createAction, showToast } from "@mileniumhq/paperui";
import { MAX_TEXT_LENGTH } from "issues/shared";
import { shellIpc } from "../../lib/shell";

/**
 * Report an Issue: the person says what went wrong, and it goes to
 * Paperboard's maintainer with this app's version and system. It stays
 * mounted and opens per request, so PaperModal plays its own open and
 * close; what was typed stays until it's sent.
 */
export default function IssueReport(props: { open: boolean; onClose: () => void }) {
    const [text, setText] = createSignal("");
    const send = createAction();

    const submit = () => {
        if (!text().trim() || send.busy()) return;
        void send.run("Couldn't send the issue", async () => {
            await shellIpc().invoke("issue-send", { text: text() });
            batch(() => {
                setText("");
                props.onClose();
            });
            showToast({ variant: "success", title: "Issue sent", message: "Thanks for telling us." });
        });
    };

    return (
        // omitting onClose while sending blocks Esc, backdrop, and the X button
        <PaperModal
            open={props.open}
            title="Report an Issue"
            onClose={send.busy() ? undefined : props.onClose}
            footer={
                <>
                    <PaperButton variant="text" disabled={send.busy()} onClick={() => props.onClose()}>
                        Cancel
                    </PaperButton>
                    <PaperEffect variant="primary">
                        <PaperButton disabled={!text().trim() || send.busy()} onClick={submit}>
                            {send.busy() ? "Sending..." : "Send"}
                        </PaperButton>
                    </PaperEffect>
                </>
            }
        >
            <PaperFlex direction="column" gap="full">
                <PaperInput
                    label="What went wrong?"
                    placeholder="What happened, and what you expected"
                    autofocus
                    multiline
                    rows={6}
                    fullWidth
                    maxLength={MAX_TEXT_LENGTH}
                    disabled={send.busy()}
                    value={text()}
                    onInput={(event) => setText(event.currentTarget.value)}
                />
                <PaperText preset="hint">
                    Goes to Paperboard's maintainer with this app's version and your operating system. Nothing else from this computer is sent.
                </PaperText>
            </PaperFlex>
        </PaperModal>
    );
}
