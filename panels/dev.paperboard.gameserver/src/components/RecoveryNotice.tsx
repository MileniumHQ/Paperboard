import { Show } from "solid-js";
import { useServer } from "../lib/server";
import { createAction, PaperError } from "@mileniumhq/paperui";
import { errorMessage } from "../lib/failure";

// A server that could not be set up, or an interrupted install or modpack
// change that could not be cleaned up, blocks starting the server and every
// install. Said, with why, wherever those are started, with the one action
// that can lift the block.
export default function RecoveryNotice() {
    const { calls, initFailure, recoveryBlock } = useServer();
    const retry = createAction({ message: errorMessage });
    const notice = () => {
        const init = initFailure();
        if (init !== null) return { title: "Couldn't set up this server", error: init, action: "Try again", failed: "Couldn't retry the setup", call: calls.retryInitialize };
        const block = recoveryBlock();
        if (block !== null) return { title: "Couldn't clean up the server folder", error: block, action: "Retry cleanup", failed: "Couldn't retry the cleanup", call: calls.retryRecovery };
        return null;
    };

    return (
        <Show when={notice()}>
            {(shown) => (
                <PaperError
                    title={shown().title}
                    error={shown().error}
                    action={{
                        label: retry.busy() ? "Retrying…" : shown().action,
                        disabled: retry.busy(),
                        onClick: () => void retry.run(shown().failed, () => shown().call()),
                    }}
                />
            )}
        </Show>
    );
}
