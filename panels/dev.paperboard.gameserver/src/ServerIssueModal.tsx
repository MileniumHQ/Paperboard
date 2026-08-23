import { type Component, For, Show } from "solid-js";
import { PaperFlex, PaperModal, PaperButton, PaperText, PaperIcon } from "paperui";
import { activeIssue, clearActiveIssue } from "./diagnostics";

const ServerIssueModal: Component = () => {
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
                                        onClick={() => action.action()}
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
