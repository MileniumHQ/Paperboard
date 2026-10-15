import { createSignal, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import { ACTION_IDS } from "../service/contract";
import { recoveryBlock, serverBridge } from "../lib/server";

// An interrupted install or modpack change that could not be cleaned up
// blocks starting the server and every install. Shown wherever those are
// started, with the one action that can lift the block.
export default function RecoveryNotice() {
    const [retrying, setRetrying] = createSignal(false);
    const [failure, setFailure] = createSignal("");

    const retry = async () => {
        setRetrying(true);
        setFailure("");
        try {
            await serverBridge.call(ACTION_IDS.retryRecovery);
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        } finally {
            setRetrying(false);
        }
    };

    return (
        <Show when={recoveryBlock()}>
            <PaperQuote variant="danger" icon="warning" title="The server folder needs cleaning up">
                <PaperFlex direction="column" gap="half">
                    <span>{recoveryBlock()}</span>
                    <span>Starting the server and installing stay blocked until this succeeds.</span>
                    <Show when={failure()}>
                        <span>{failure()}</span>
                    </Show>
                    <PaperFlex direction="row">
                        <PaperButton onClick={retry} disabled={retrying()}>
                            {retrying() ? "Retrying…" : "Retry cleanup"}
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperQuote>
        </Show>
    );
}
