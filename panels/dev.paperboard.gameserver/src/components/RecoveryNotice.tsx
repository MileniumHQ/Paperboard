import { Show } from "solid-js";
import { createAction, PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import { CALLS, SETUP_CALLS } from "../service/contract";
import { initFailure, recoveryBlock, serverBridge } from "../lib/server";
import { errorMessage } from "../lib/failure";

// A server that could not be set up, or an interrupted install or modpack
// change that could not be cleaned up, blocks starting the server and every
// install. Shown wherever those are started, with the one action that can
// lift the block.
export default function RecoveryNotice() {
    const retry = createAction({ message: errorMessage });
    const notice = () =>
        initFailure() !== null
            ? { title: "This server could not be set up", reason: initFailure()!, blocks: "Nothing on this server works until setting it up succeeds.", action: "Try again", call: SETUP_CALLS.retryInitialize }
            : recoveryBlock() !== null
              ? { title: "The server folder needs cleaning up", reason: recoveryBlock()!, blocks: "Starting the server and installing stay blocked until this succeeds.", action: "Retry cleanup", call: CALLS.retryRecovery }
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
                            <PaperButton onClick={() => void retry.run(shown().title, () => serverBridge.call(shown().call))} disabled={retry.busy()}>
                                {retry.busy() ? "Retrying…" : shown().action}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );
}
