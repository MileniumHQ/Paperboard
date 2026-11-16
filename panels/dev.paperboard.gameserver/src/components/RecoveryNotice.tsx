import { Show } from "solid-js";
import { useServer } from "../lib/server";
import { createAction, PaperButton, PaperFlex, PaperQuote, showError } from "@mileniumhq/paperui";
import { errorMessage } from "../lib/failure";

// A server that could not be set up, or an interrupted install or modpack
// change that could not be cleaned up, blocks starting the server and every
// install. Shown wherever those are started, with the one action that can
// lift the block; the server's page toasts why (createServerPage).
export default function RecoveryNotice() {
    const { calls, initFailure, recoveryBlock } = useServer();
    const retry = createAction({ message: errorMessage });
    const notice = () =>
        initFailure() !== null
            ? { title: "This server isn't set up", blocks: "Nothing on this server works until setting it up succeeds.", action: "Try again", failed: "Couldn't retry the setup", call: calls.retryInitialize }
            : recoveryBlock() !== null
              ? { title: "The server folder needs cleaning up", blocks: "Starting the server and installing stay blocked until this succeeds.", action: "Retry cleanup", failed: "Couldn't retry the cleanup", call: calls.retryRecovery }
              : null;

    return (
        <Show when={notice()}>
            {(shown) => (
                <PaperQuote variant="warning" icon="warning" title={shown().title}>
                    <PaperFlex direction="column" gap="half">
                        <span>{shown().blocks}</span>
                        <PaperFlex direction="row">
                            <PaperButton
                                onClick={() => void retry.run(shown().failed, () => shown().call(), (failure) => failure && showError(failure.title, failure.message))}
                                disabled={retry.busy()}
                            >
                                {retry.busy() ? "Retrying…" : shown().action}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );
}
