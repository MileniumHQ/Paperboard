import { Show } from "solid-js";
import { useServer } from "../lib/server";
import { createAction, PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import { errorMessage } from "../lib/failure";

// A server that could not be set up, or an interrupted install or modpack
// change that could not be cleaned up, blocks starting the server and every
// install. Shown wherever those are started, with the one action that can
// lift the block.
export default function RecoveryNotice() {
    const { calls, initFailure, recoveryBlock } = useServer();
    const retry = createAction({ message: errorMessage });
    const notice = () =>
        initFailure() !== null
            ? { title: "This server could not be set up", reason: initFailure()!, blocks: "Nothing on this server works until setting it up succeeds.", action: "Try again", call: calls.retryInitialize }
            : recoveryBlock() !== null
              ? { title: "The server folder needs cleaning up", reason: recoveryBlock()!, blocks: "Starting the server and installing stay blocked until this succeeds.", action: "Retry cleanup", call: calls.retryRecovery }
              : null;

    return (
        <Show when={notice()}>
            {(shown) => (
                <PaperQuote variant="danger" icon="warning" title={shown().title}>
                    <PaperFlex direction="column" gap="half">
                        <span>{shown().reason}</span>
                        <span>{shown().blocks}</span>
                        <Show when={retry.error()}>
                            {(failure) => <span>{failure().message}</span>}
                        </Show>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => void retry.run(shown().title, () => shown().call())} disabled={retry.busy()}>
                                {retry.busy() ? "Retrying…" : shown().action}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );
}
