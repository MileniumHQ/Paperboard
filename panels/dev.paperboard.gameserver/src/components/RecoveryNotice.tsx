import { createSignal, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import { CALLS, SETUP_CALLS } from "../service/contract";
import { initFailure, recoveryBlock, serverBridge } from "../lib/server";
import { errorMessage } from "../lib/failure";

// A server that could not be set up, or an interrupted install or modpack
// change that could not be cleaned up, blocks starting the server and every
// install. Shown wherever those are started, with the one action that can
// lift the block.
export default function RecoveryNotice() {
    const [retrying, setRetrying] = createSignal(false);
    const [failure, setFailure] = createSignal("");
    const notice = () =>
        initFailure() !== null
            ? { title: "This server could not be set up", reason: initFailure()!, blocks: "Nothing on this server works until setting it up succeeds.", action: "Try again", call: SETUP_CALLS.retryInitialize }
            : recoveryBlock() !== null
              ? { title: "The server folder needs cleaning up", reason: recoveryBlock()!, blocks: "Starting the server and installing stay blocked until this succeeds.", action: "Retry cleanup", call: CALLS.retryRecovery }
              : null;

    const retry = async (call: string) => {
        setRetrying(true);
        setFailure("");
        try {
            await serverBridge.call(call);
        } catch (err) {
            setFailure(errorMessage(err));
        } finally {
            setRetrying(false);
        }
    };

    return (
        <Show when={notice()}>
            {(shown) => (
                <PaperQuote variant="danger" icon="warning" title={shown().title}>
                    <PaperFlex direction="column" gap="half">
                        <span>{shown().reason}</span>
                        <span>{shown().blocks}</span>
                        <Show when={failure()}>
                            <span>{failure()}</span>
                        </Show>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => retry(shown().call)} disabled={retrying()}>
                                {retrying() ? "Retrying…" : shown().action}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            )}
        </Show>
    );
}
