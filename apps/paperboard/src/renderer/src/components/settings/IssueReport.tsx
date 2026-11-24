import { Match, Switch, batch, createSignal } from "solid-js";
import {
    PaperButton,
    PaperCheckbox,
    PaperCode,
    PaperCollapsible,
    PaperEffect,
    PaperError,
    PaperFlex,
    PaperInput,
    PaperLoader,
    PaperModal,
    PaperText,
    createAction,
    createRead,
    showToast,
} from "@mileniumhq/paperui";
import { MAX_TEXT_LENGTH } from "issues/shared";
import { shellIpc } from "../../lib/shell";

/**
 * Report an Issue: the person says what went wrong, and it goes to
 * Paperboard's maintainer with this app's version and system, and unless
 * they leave it out, the diagnostics they can read right here: the
 * computer, its panels, and recent log lines, scrubbed. It stays mounted
 * and opens per request, so PaperModal plays its own open and close; what
 * was typed stays until it's sent.
 */
export default function IssueReport(props: { open: boolean; onClose: () => void }) {
    const [text, setText] = createSignal("");
    const [includeDetails, setIncludeDetails] = createSignal(true);
    // gathered afresh each time the form opens, so it holds the latest log lines
    const details = createRead(() => shellIpc().invoke("issue-details"), { source: () => props.open });
    const send = createAction();

    // with diagnostics on, only once they're gathered: what's sent is what was shown
    const ready = () => text().trim() !== "" && (!includeDetails() || details.value() !== undefined);

    const submit = () => {
        if (!ready() || send.busy()) return;
        const attached = includeDetails() ? (details.value() ?? "") : "";
        void send.run("Couldn't send the issue", async () => {
            await shellIpc().invoke("issue-send", { text: text(), details: attached });
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
                        <PaperButton disabled={!ready() || send.busy()} onClick={submit}>
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
                <PaperFlex direction="column" gap="half">
                    <PaperCheckbox
                        checked={includeDetails()}
                        onChange={setIncludeDetails}
                        disabled={send.busy()}
                        label="Include logs and panel versions"
                        description="Recent warnings, errors and log lines, and the panels on the computer you're looking at. Paths, names, addresses and keys are removed."
                    />
                    <PaperCollapsible title="See what's sent" icon="visibility">
                        <Switch>
                            <Match when={details.error() && details.value() === undefined}>
                                <PaperError
                                    title="Couldn't gather the logs"
                                    error={details.error()}
                                    action={{ label: "Try again", disabled: details.loading(), onClick: () => void details.reload() }}
                                />
                            </Match>
                            <Match when={details.value() === undefined}>
                                <PaperLoader loaderStatus="indeterminate" centered delay={150} label="Gathering logs..." />
                            </Match>
                            <Match when={details.value()}>
                                {(attached) => (
                                    <PaperFlex direction="column" maxHeight="panel-height-small" scrollable>
                                        <PaperCode block wrap language="text">
                                            {includeDetails() ? attached() : "Nothing: the logs and panel versions are left out."}
                                        </PaperCode>
                                    </PaperFlex>
                                )}
                            </Match>
                        </Switch>
                    </PaperCollapsible>
                </PaperFlex>
                <PaperText preset="hint">Goes to Paperboard's maintainer with this app's version and your operating system.</PaperText>
            </PaperFlex>
        </PaperModal>
    );
}
