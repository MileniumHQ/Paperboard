import { PANEL_ID } from "../service/types";
import { type Component, createEffect, createMemo, createRoot, createSignal, For, on, Show } from "solid-js";
import {
    PaperModal,
    PaperButton,
    PaperText,
    PaperIcon,
    showError,
} from "@mileniumhq/paperui";
import type { ServerIssue, ServerIssueAction } from "../core/diagnostics";
import { useServer, type ServerStatus } from "../lib/server";
import { errorMessage } from "../lib/failure";

/** Resolves true once the server is offline, or false if it turns out to run after all. */
function whenOffline(serverStatus: () => ServerStatus): Promise<boolean> {
    return new Promise((resolve) =>
        createRoot((dispose) =>
            createEffect(
                on(serverStatus, (status) => {
                    if (status !== "offline" && status !== "online") return;
                    dispose();
                    resolve(status === "offline");
                }),
            ),
        ),
    );
}

const ServerIssueModal: Component = () => {
    const { activeIssue, calls, files, serverPort, serverStatus, startServer } = useServer();
    const [repairing, setRepairing] = createSignal(false);
    // the last issue stays on the modal while it closes, so it animates out instead of vanishing
    const shownIssue = createMemo<ServerIssue | null>((prev) => activeIssue() ?? prev, null);

    // the repair, then a start once the start that failed has ended: a start
    // asked for while it is still ending would do nothing
    const repair = async (action: ServerIssueAction) => {
        if (repairing()) return;
        setRepairing(true);
        let repaired = false;
        try {
            switch (action.actionKey) {
                case "killPortAndRetry":
                    // ends what holds the port; rejects with why it could not
                    await calls.killConflictingProcess({ port: serverPort() });
                    break;
                case "acceptEula":
                    await files.write("eula.txt", "eula=true\n", PANEL_ID);
                    break;
            }
            await calls.clearActiveIssue();
            repaired = true;
        } catch (err) {
            // the issue stays open, and a toast over it says why
            showError("Couldn't repair the server", errorMessage(err));
        } finally {
            setRepairing(false);
        }
        if (repaired && (await whenOffline(serverStatus))) startServer();
    };

    // a dismissal the service refused leaves the issue open, saying why
    const dismiss = () => {
        calls.clearActiveIssue().catch((err) => showError("Couldn't dismiss the issue", errorMessage(err)));
    };

    return (
        <PaperModal
            open={activeIssue() !== null}
            onClose={dismiss}
            title={shownIssue()?.title}
            size="small"
            footer={
                <>
                    <PaperButton onClick={dismiss}>
                        Dismiss
                    </PaperButton>
                    <For each={shownIssue()?.actions}>
                        {(action) => (
                            <PaperButton
                                variant={action.variant || "brand"}
                                disabled={repairing()}
                                onClick={() => void repair(action)}>
                                <Show when={action.icon}>
                                    <PaperIcon>{action.icon}</PaperIcon>
                                </Show>
                                {action.label}
                            </PaperButton>
                        )}
                    </For>
                </>
            }
        >
            <PaperText preset="body">{shownIssue()?.description}</PaperText>
        </PaperModal>
    );
};

export default ServerIssueModal;
