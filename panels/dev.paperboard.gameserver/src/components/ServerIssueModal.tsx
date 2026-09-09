import { type Component, For, Show } from "solid-js";
import { PaperFlex, PaperModal, PaperButton, PaperText, PaperIcon } from "@paperboard-dev/paperui";
import { files as fileApi } from "@paperboard-dev/paperapi";
import { activeIssue, clearActiveIssue, killConflictingProcess, resetWorldFiles } from "../lib/diagnostics";
import { serverPort, startServer } from "../lib/server";

const ServerIssueModal: Component = () => {
    const handleActionClick = async (action: any) => {
        if (typeof action.action === "function") {
            await action.action();
            return;
        }
        if (action.actionKey === "killPortAndRetry") {
            await killConflictingProcess(serverPort());
            clearActiveIssue();
            setTimeout(() => startServer(), 600);
        } else if (action.actionKey === "acceptEula") {
            await fileApi.write("eula.txt", "eula=true\n");
            clearActiveIssue();
            setTimeout(() => startServer(), 400);
        } else if (action.actionKey === "resetWorldAndStart") {
            await resetWorldFiles();
            clearActiveIssue();
            setTimeout(() => startServer(), 500);
        } else {
            clearActiveIssue();
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
                            <PaperButton compact onClick={clearActiveIssue}>
                                Dismiss
                            </PaperButton>
                            <For each={issue().actions}>
                                {(action) => (
                                    <PaperButton
                                        compact
                                        variant={action.variant || "brand"}
                                        onClick={() => handleActionClick(action)}
                                    >
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
                    <PaperText preset="body">{issue().description}</PaperText>
                </PaperModal>
            )}
        </Show>
    );
};

export default ServerIssueModal;
