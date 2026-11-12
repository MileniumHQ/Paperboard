// Saved commands, managed in the panel: add, run, remove. The list and every
// outcome are the service's; this only asks and shows what it answered.
import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperQuote,
    PaperText,
    type PaperColor,
} from "@mileniumhq/paperui";
import { serviceApi } from "@mileniumhq/paperapi";
import type { CommandRun, SavedCommand } from "./lib/savedCommands";
import { MAX_LABEL_LENGTH, MAX_SAVED_COMMANDS } from "./lib/savedCommands";
import { describeRun, type RunTone } from "./lib/runStatus";
import { errorMessage, type Outcome } from "./lib/failure";

const PANEL_ID = "dev.paperboard.terminal";

const TONE_COLOR: Record<RunTone, PaperColor> = {
    idle: "text-subtle",
    running: "text-subtle",
    success: "success",
    danger: "danger",
    warning: "warning",
};

export default function SavedCommandsModal(props: {
    open: boolean;
    onClose: () => void;
    commands: SavedCommand[];
    runs: Record<string, CommandRun>;
    loadError: string;
    /** A run started from the toolbar dropdown that failed. */
    runError?: string;
}) {
    const [label, setLabel] = createSignal("");
    const [command, setCommand] = createSignal("");
    const [error, setError] = createSignal<Outcome | null>(null);
    const [busy, setBusy] = createSignal(false);

    const call = async (title: string, name: string, input: Record<string, unknown>) => {
        setError(null);
        setBusy(true);
        try {
            return await serviceApi.call(PANEL_ID, name, input);
        } catch (err) {
            setError({ title, message: errorMessage(err) });
            return undefined;
        } finally {
            setBusy(false);
        }
    };

    const full = () => props.commands.length >= MAX_SAVED_COMMANDS;
    const canSave = () => !busy() && !props.loadError && !full() && command().trim() !== "";

    const save = async () => {
        if (!canSave()) return;
        const id = await call("Command not saved", "save-command", { label: label(), command: command() });
        if (id) {
            setLabel("");
            setCommand("");
        }
    };

    // this modal's own failure, else the dropdown's run that brought it open
    const shownError = (): Outcome | null =>
        error() ?? (props.runError ? { title: "Command not started", message: props.runError } : null);

    return (
        <PaperModal open={props.open} onClose={props.onClose} title="Saved commands" size="medium">
            <PaperFlex direction="column" gap="full" fullWidth>
                <PaperText preset="text">
                    Run these from here, or pin one to Home with the Pinned command widget.
                </PaperText>
                <Show when={props.loadError}>
                    <PaperQuote variant="danger" icon="warning" title="Saved commands unreadable" role="alert">
                        {props.loadError}
                    </PaperQuote>
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
                                    <PaperCard surface="element" borderless paddingX="full" paddingY="half">
                                        <PaperFlex direction="row" align="center" gap="half" fullWidth>
                                            <PaperFlex direction="column" flex minWidth={0}>
                                                <PaperText preset="label" truncate>{saved.label}</PaperText>
                                                <PaperText preset="hint" truncate family="code" title={saved.command}>
                                                    {saved.command}
                                                </PaperText>
                                            </PaperFlex>
                                            <PaperText preset="hint" truncate color={TONE_COLOR[status().tone]} title={status().detail}>
                                                {status().text}
                                            </PaperText>
                                            <PaperButton
                                                size="small"
                                                disabled={busy() || props.runs[saved.id]?.state === "running"}
                                                onClick={() => void call("Command not started", "run-saved-command", { id: saved.id })}
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
                                                onClick={() => void call("Command not removed", "remove-saved-command", { id: saved.id })}
                                            >
                                                <PaperIcon>delete</PaperIcon>
                                            </PaperButton>
                                        </PaperFlex>
                                    </PaperCard>
                                );
                            }}
                        </For>
                    </PaperFlex>
                </Show>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        label="Name (optional)"
                        maxLength={MAX_LABEL_LENGTH}
                        value={label()}
                        onInput={(e) => setLabel(e.currentTarget.value)}
                    />
                    <PaperFlex direction="row" gap="half" align="end" fullWidth>
                        <PaperInput
                            fullWidth
                            label="Command"
                            placeholder="git pull"
                            value={command()}
                            onInput={(e) => setCommand(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void save();
                            }}
                        />
                        <PaperButton variant="primary" disabled={!canSave()} onClick={() => void save()}>
                            <PaperIcon>bookmark_add</PaperIcon> Save
                        </PaperButton>
                    </PaperFlex>
                    <Show when={full()}>
                        <PaperText preset="hint">
                            Terminal keeps {MAX_SAVED_COMMANDS} saved commands at most. Remove one to save another.
                        </PaperText>
                    </Show>
                </PaperFlex>
                <Show when={shownError()}>
                    {(shown) => (
                        <PaperQuote variant="danger" icon="warning" title={shown().title} role="alert">
                            {shown().message}
                        </PaperQuote>
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
