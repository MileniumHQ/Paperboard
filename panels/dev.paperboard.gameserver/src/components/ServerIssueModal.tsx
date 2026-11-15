import { PANEL_ID } from "../service/types";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperModal,
    PaperButton,
    PaperText,
    PaperIcon,
    PaperQuote,
} from "@mileniumhq/paperui";
import { files as fileApi } from "../lib/api";
import { activeIssue, clearActiveIssue, killConflictingProcess, resetWorldFiles, type ServerIssue } from "../lib/diagnostics";
import { serverPort, startServer } from "../lib/server";
import { errorMessage } from "../lib/failure";

const ServerIssueModal: Component = () => {
    const [actionError, setActionError] = createSignal<{ title: string; message: string } | null>(null);
    // the last issue stays on the modal while it closes, so it animates out instead of vanishing
    const shownIssue = createMemo<ServerIssue | null>((prev) => activeIssue() ?? prev, null);

    // pty/repair failures arrive as developer-speak; the customer needs
    // "what happened to my data, retry or do it manually", not shell
    // vocabulary. Order matters: a wrapped trash failure contains BOTH
    // phrases — the recoverability fact must win over the timeout fact.
    const humanizeRepairError = (err: unknown): string => {
        const raw = errorMessage(err);
        if (/trash|remains on disk/i.test(raw)) {
            return "Resetting stopped partway: the world files were moved to a '.trash-*' folder in your server directory and are recoverable there. You can retry, or clean that folder up manually.";
        }
        if (/did not complete|timed out/i.test(raw)) {
            return "The repair did not finish in time. Nothing was changed. You can retry, or fix the problem manually.";
        }
        if (/without the/i.test(raw)) {
            return "The repair stopped partway before it finished. You can retry.";
        }
        return raw;
    };

    const handleActionClick = async (action: any) => {
        setActionError(null);
        try {
            if (typeof action.action === "function") {
                await action.action();
                return;
            }
            if (action.actionKey === "killPortAndRetry") {
                // a kill that failed throws, and the catch below shows why
                await killConflictingProcess(serverPort());
                await clearActiveIssue();
                setTimeout(() => startServer(), 600);
            } else if (action.actionKey === "acceptEula") {
                await fileApi.write("eula.txt", "eula=true\n", PANEL_ID);
                await clearActiveIssue();
                setTimeout(() => startServer(), 400);
            } else if (action.actionKey === "resetWorldAndStart") {
                await resetWorldFiles();
                await clearActiveIssue();
                setTimeout(() => startServer(), 500);
            } else {
                await clearActiveIssue();
            }
        } catch (err) {
            // a repair action that throws must not become an unhandled
            // rejection — the issue stays open and the reason is shown
            setActionError({ title: "Repair failed", message: humanizeRepairError(err) });
        }
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
                                onClick={() => handleActionClick(action)}>
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
