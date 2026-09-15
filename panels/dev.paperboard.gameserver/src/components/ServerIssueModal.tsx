import { PANEL_ID } from "../service/types";
import { type Component, createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperModal,
    PaperButton,
    PaperText,
    PaperIcon,
    PaperQuote,
} from "@paperboard-dev/paperui";
import { files as fileApi } from "@paperboard-dev/paperapi";
import { activeIssue, clearActiveIssue, killConflictingProcess, resetWorldFiles } from "../lib/diagnostics";
import { serverPort, startServer } from "../lib/server";

const ServerIssueModal: Component = () => {
    const [actionError, setActionError] = createSignal("");

    // pty/repair failures arrive as developer-speak; the customer needs
    // "what happened to my data, retry or do it manually", not shell
    // vocabulary. Order matters: a wrapped trash failure contains BOTH
    // phrases — the recoverability fact must win over the timeout fact.
    const humanizeRepairError = (err: unknown): string => {
        const raw = err instanceof Error ? err.message : String(err);
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
        setActionError("");
        try {
            if (typeof action.action === "function") {
                await action.action();
                return;
            }
            if (action.actionKey === "killPortAndRetry") {
                const ok = await killConflictingProcess(serverPort());
                // A failed repair is not a silent dead click: the reason is
                // rendered so the user can decide between retry and manual
                // recovery. The issue stays visibly open either way.
                if (!ok) {
                    setActionError(
                        "Killing the process on that port did not complete. Nothing was shut down. You can retry, or fix the port conflict manually.",
                    );
                    return;
                }
                clearActiveIssue();
                setTimeout(() => startServer(), 600);
            } else if (action.actionKey === "acceptEula") {
                await fileApi.write("eula.txt", "eula=true\n", PANEL_ID);
                clearActiveIssue();
                setTimeout(() => startServer(), 400);
            } else if (action.actionKey === "resetWorldAndStart") {
                const ok = await resetWorldFiles();
                if (!ok) {
                    setActionError(
                        "Resetting stopped partway: the world files are exactly where they started, or staged in a '.trash-*' folder in your server directory and recoverable there. You can retry.",
                    );
                    return;
                }
                clearActiveIssue();
                setTimeout(() => startServer(), 500);
            } else {
                clearActiveIssue();
            }
        } catch (err) {
            // a repair action that throws must not become an unhandled
            // rejection — the issue stays open and the reason is shown
            setActionError(humanizeRepairError(err));
        }
    };

    return (
        <Show when={activeIssue()}>
            {(issue) => (
                <PaperModal
                    open={true}
                    onClose={clearActiveIssue}
                    title={issue().title}
                    size="small"
                    footer={
                        <PaperFlex
                            direction="row"
                            justify="flex-end"
                            gap="half"
                            fullWidth
                        >
                            <PaperButton onClick={clearActiveIssue}>
                                Dismiss
                            </PaperButton>
                            <For each={issue().actions}>
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
                        </PaperFlex>
                    }
                >
                    <PaperFlex direction="column" gap="half" fullWidth>
                        <PaperText preset="body">{issue().description}</PaperText>
                        <Show when={actionError()}>
                            {(error) => (
                                <PaperQuote variant="danger" icon="warning" title="Repair failed">
                                    {error()}
                                </PaperQuote>
                            )}
                        </Show>
                    </PaperFlex>
                </PaperModal>
            )}
        </Show>
    );
};

export default ServerIssueModal;
