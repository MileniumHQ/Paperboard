// Saved commands, managed in the panel: add, run, remove. The list and every
// outcome are the service's; this only asks and shows what it answered.
import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperText,
} from "@mileniumhq/paperui";
import { actions as actionsApi } from "@mileniumhq/paperapi";
import type { CommandRun, SavedCommand } from "./lib/savedCommands";
import { MAX_LABEL_LENGTH, MAX_SAVED_COMMANDS } from "./lib/savedCommands";
import { describeRun } from "./lib/runStatus";

const PANEL_ID = "dev.paperboard.terminal";

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export default function SavedCommandsModal(props: {
    open: boolean;
    onClose: () => void;
    commands: SavedCommand[];
    runs: Record<string, CommandRun>;
    loadError: string;
}) {
    const [label, setLabel] = createSignal("");
    const [command, setCommand] = createSignal("");
    const [error, setError] = createSignal("");
    const [busy, setBusy] = createSignal(false);

    const call = async (action: string, inputs: Record<string, unknown>) => {
        setError("");
        setBusy(true);
        try {
            return await actionsApi.call(PANEL_ID, action, inputs);
        } catch (err) {
            setError(message(err));
            return undefined;
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        if (!command().trim()) {
            setError("Type a command to save");
            return;
        }
        const id = await call("save-command", { label: label(), command: command() });
        if (id) {
            setLabel("");
            setCommand("");
        }
    };

    return (
        <PaperModal open={props.open} onClose={props.onClose} title="Saved commands" size="medium">
            <PaperFlex direction="column" gap="full" fullWidth>
                <PaperText color="text-subtle">
                    Run these from here, or pin one to Home with the Pinned command widget.
                </PaperText>
                <Show when={props.loadError}>
                    <PaperText color="danger">{props.loadError}</PaperText>
                </Show>
                <Show
                    when={props.commands.length > 0}
                    fallback={
                        <Show when={!props.loadError}>
                            <PaperEmptyState icon="bookmarks" title="No saved commands" description="Save one below." />
                        </Show>
                    }
                >
                    <PaperFlex direction="column" gap="half" fullWidth>
                        <For each={props.commands}>
                            {(saved) => {
                                const status = () => describeRun(props.runs[saved.id], Date.now());
                                return (
                                    <PaperFlex direction="row" align="center" gap="half" fullWidth class="saved-command-row">
                                        <PaperFlex direction="column" style={{ flex: 1, "min-width": 0 }}>
                                            <PaperText truncate class="saved-command-label">{saved.label}</PaperText>
                                            <PaperText truncate family="code" color="text-subtle" title={saved.command}>
                                                {saved.command}
                                            </PaperText>
                                        </PaperFlex>
                                        <PaperText class={`run-status tone-${status().tone}`} title={status().detail}>
                                            {status().text}
                                        </PaperText>
                                        <PaperButton
                                            size="small"
                                            disabled={busy() || props.runs[saved.id]?.state === "running"}
                                            onClick={() => void call("run-saved-command", { id: saved.id })}
                                        >
                                            <PaperIcon>play_arrow</PaperIcon> Run
                                        </PaperButton>
                                        <PaperButton
                                            size="small"
                                            variant="text"
                                            icon
                                            disabled={busy()}
                                            title={`Remove ${saved.label}`}
                                            aria-label={`Remove ${saved.label}`}
                                            onClick={() => void call("remove-saved-command", { id: saved.id })}
                                        >
                                            <PaperIcon>delete</PaperIcon>
                                        </PaperButton>
                                    </PaperFlex>
                                );
                            }}
                        </For>
                    </PaperFlex>
                </Show>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        placeholder="Name (optional)"
                        aria-label="Name"
                        maxLength={MAX_LABEL_LENGTH}
                        value={label()}
                        onInput={(e) => setLabel(e.currentTarget.value)}
                    />
                    <PaperFlex direction="row" gap="half" fullWidth>
                        <PaperInput
                            fullWidth
                            placeholder="Command, e.g. git pull"
                            aria-label="Command"
                            value={command()}
                            onInput={(e) => setCommand(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void save();
                            }}
                        />
                        <PaperButton
                            variant="primary"
                            disabled={busy() || !!props.loadError || props.commands.length >= MAX_SAVED_COMMANDS}
                            onClick={() => void save()}
                        >
                            <PaperIcon>bookmark_add</PaperIcon> Save
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
                <Show when={error()}>
                    <PaperText color="danger" role="alert">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
