import { PANEL_ID } from "../service/types";
import { type Component, createEffect, createMemo, createRoot, createSignal, For, on, Show } from "solid-js";
import {
    PaperFlex,
    PaperModal,
    PaperButton,
    PaperText,
    PaperIcon,
    PaperQuote,
} from "@mileniumhq/paperui";
import { files as fileApi } from "../lib/api";
import { activeIssue, clearActiveIssue, killConflictingProcess, type ServerIssue, type ServerIssueAction } from "../lib/diagnostics";
import { serverPort, serverStatus, startServer } from "../lib/server";
import { errorMessage } from "../lib/failure";

/** Resolves true once the server is offline, or false if it turns out to run after all. */
function whenOffline(): Promise<boolean> {
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
    const [actionError, setActionError] = createSignal<{ title: string; message: string } | null>(null);
    const [repairing, setRepairing] = createSignal(false);
    // the last issue stays on the modal while it closes, so it animates out instead of vanishing
    const shownIssue = createMemo<ServerIssue | null>((prev) => activeIssue() ?? prev, null);

    // the repair, then a start once the start that failed has ended: a start
    // asked for while it is still ending would do nothing
    const repair = async (action: ServerIssueAction) => {
        if (repairing()) return;
        setActionError(null);
        setRepairing(true);
        try {
            switch (action.actionKey) {
                case "killPortAndRetry":
                    await killConflictingProcess(serverPort());
                    break;
                case "acceptEula":
                    await fileApi.write("eula.txt", "eula=true\n", PANEL_ID);
                    break;
            }
            await clearActiveIssue();
        } catch (err) {
            // the issue stays open and says why
            setActionError({ title: "Repair failed", message: errorMessage(err) });
            return;
        } finally {
            setRepairing(false);
        }
        if (await whenOffline()) startServer();
    };

    // a dismissal the service refused leaves the issue open, saying why
    const dismiss = () => {
        setActionError(null);
        clearActiveIssue().catch((err) => setActionError({ title: "Issue not dismissed", message: errorMessage(err) }));
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
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperText preset="body">{shownIssue()?.description}</PaperText>
                <Show when={actionError()}>
                    {(error) => (
                        <PaperQuote variant="danger" icon="warning" title={error().title}>
                            {error().message}
                        </PaperQuote>
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default ServerIssueModal;
