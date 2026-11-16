// Saved commands, run from the toolbar's menu and managed in a modal: add,
// run, remove. The list and every outcome are the service's; this only asks
// and shows what it answered.
import { createSignal, For, Index, Show } from "solid-js";
import {
    PaperButton,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperText,
    stripAnsi,
    type PaperColor,
    createAction,
    createFailureToast,
    showError,
} from "@mileniumhq/paperui";
import { terminal } from "./client";
import type { CommandRun, SavedCommand } from "./lib/contract";
import { MAX_LABEL_LENGTH, MAX_SAVED_COMMANDS } from "./lib/savedCommands";
import { describeRun, type RunTone } from "./lib/runStatus";
import { createAgoClock } from "./lib/clock";
import { Menu, type MenuState } from "./Menus";

const TONE_COLOR: Record<RunTone, PaperColor> = {
    idle: "text-subtle",
    running: "text-subtle",
    success: "success",
    danger: "danger",
    warning: "warning",
};

const START_FAILED = "Couldn't start the command";

/** The last lines a finished run printed, as plain text: how a failure says why. */
function runOutput(run: CommandRun | undefined): string[] {
    if (!run || run.state === "running" || !run.output) return [];
    return run.output.split("\n").map(stripAnsi);
}

interface SavedCommandsProps {
    commands: SavedCommand[];
    runs: Record<string, CommandRun>;
    loadError: string;
}

/** The toolbar's Saved commands menu, and the modal it manages them in. */
export default function SavedCommands(props: SavedCommandsProps & { menu: MenuState }) {
    const now = createAgoClock(props.menu.isOpen);
    const [isOpen, setOpen] = createSignal(false);
    // a run started from the menu that the service refused: a toast, since the menu has closed by then
    const run = (id: string) => terminal.calls.runSavedCommand({ id }).catch((err) => showError(START_FAILED, err));
    return (
        <>
            <Menu state={props.menu}>
                <PaperContextMenuHeader>Saved commands</PaperContextMenuHeader>
                <Show when={props.loadError}>
                    <PaperContextMenuItem icon="error" disabled description={props.loadError}>
                        Saved commands could not be read
                    </PaperContextMenuItem>
                </Show>
                <Show when={!props.loadError && props.commands.length === 0}>
                    <PaperContextMenuItem icon="bookmarks" disabled>
                        No saved commands
                    </PaperContextMenuItem>
                </Show>
                <For each={props.commands}>
                    {(cmd) => (
                        <PaperContextMenuItem
                            value={cmd.id}
                            icon="play_arrow"
                            description={cmd.command}
                            keybind={describeRun(props.runs[cmd.id], now()).value}
                            title={describeRun(props.runs[cmd.id], now()).detail}
                            disabled={props.runs[cmd.id]?.state === "running"}
                            onClick={() => void run(cmd.id)}
                        >
                            {cmd.label}
                        </PaperContextMenuItem>
                    )}
                </For>
                <PaperContextMenuItem value="manage-saved-commands" icon="edit" onClick={() => setOpen(true)}>
                    Manage saved commands…
                </PaperContextMenuItem>
            </Menu>
            <SavedCommandsModal
                open={isOpen()}
                onClose={() => setOpen(false)}
                commands={props.commands}
                runs={props.runs}
                loadError={props.loadError}
            />
        </>
    );
}

function SavedCommandsModal(props: {
    open: boolean;
    onClose: () => void;
    commands: SavedCommand[];
    runs: Record<string, CommandRun>;
    loadError: string;
}) {
    const now = createAgoClock(() => props.open);
    const [label, setLabel] = createSignal("");
    const [command, setCommand] = createSignal("");
    // a row's buttons never wait on another call: the service orders them,
    // and the row's run state is what says a command is already going
    const { busy, run } = createAction();
    // the refusal of the read again is the standing toast's: it goes while it reads, and comes back with why if it still can't
    const reading = createAction({ toast: false });
    // unreadable is not empty: the list says it couldn't load, and the toast says why
    createFailureToast(() => props.open && (reading.busy() ? null : (reading.error()?.message ?? props.loadError)), { title: "Couldn't read the saved commands" });

    const full = () => props.commands.length >= MAX_SAVED_COMMANDS;
    const canSave = () => !busy() && !props.loadError && !full() && command().trim() !== "";

    const save = async () => {
        if (!canSave()) return;
        if (await run("Couldn't save the command", () => terminal.calls.saveCommand({ label: label(), command: command() }))) {
            setLabel("");
            setCommand("");
        }
    };

    return (
        <PaperModal open={props.open} onClose={props.onClose} title="Saved commands" size="medium">
            <PaperFlex direction="column" gap="full" fullWidth>
                <PaperText preset="text">
                    Run these from here, or pin one to Home with the Pinned command widget.
                </PaperText>
                <Show
                    when={props.commands.length > 0}
                    fallback={
                        <Show
                            when={!props.loadError}
                            fallback={
                                <PaperEmptyState icon="error" title="Couldn't load">
                                    <PaperButton disabled={reading.busy()} onClick={() => void reading.run("Couldn't read the saved commands", terminal.calls.reloadSavedCommands)}>
                                        Try again
                                    </PaperButton>
                                </PaperEmptyState>
                            }
                        >
                            <PaperEmptyState icon="bookmarks" title="No saved commands" description="Save one below." />
                        </Show>
                    }
                >
                    <PaperList selectable={false} fullWidth borderless scrollable={false}>
                        <For each={props.commands}>
                            {(saved) => {
                                const status = () => describeRun(props.runs[saved.id], now());
                                return (
                                    <PaperListItem
                                        value={saved.id}
                                        icon="terminal"
                                        description={
                                            <PaperFlex direction="column" gap="half" minWidth={0}>
                                                {/* an unnamed command is named by its command: said once */}
                                                <Show when={saved.label !== saved.command}>
                                                    <PaperText size={1} family="code" truncate title={saved.command}>
                                                        {saved.command}
                                                    </PaperText>
                                                </Show>
                                                <PaperText size={1} color={TONE_COLOR[status().tone]} title={status().detail}>
                                                    {status().text}
                                                </PaperText>
                                                <Index each={runOutput(props.runs[saved.id])}>
                                                    {(line) => (
                                                        <PaperText size={1} family="code" color="text-subtle" breakWord>
                                                            {line()}
                                                        </PaperText>
                                                    )}
                                                </Index>
                                            </PaperFlex>
                                        }
                                        actions={
                                            <>
                                                <PaperButton
                                                    size="small"
                                                    icon
                                                    disabled={props.runs[saved.id]?.state === "running"}
                                                    title={`Run ${saved.command}`}
                                                    aria-label={`Run ${saved.label}`}
                                                    onClick={() => void run(START_FAILED, () => terminal.calls.runSavedCommand({ id: saved.id }))}
                                                >
                                                    <PaperIcon>play_arrow</PaperIcon>
                                                </PaperButton>
                                                <PaperButton
                                                    size="small"
                                                    variant="text"
                                                    icon
                                                    title={`Remove ${saved.label}`}
                                                    aria-label={`Remove ${saved.label}`}
                                                    onClick={() => void run("Couldn't remove the command", () => terminal.calls.removeSavedCommand({ id: saved.id }))}
                                                >
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </>
                                        }
                                    >
                                        {saved.label}
                                    </PaperListItem>
                                );
                            }}
                        </For>
                    </PaperList>
                </Show>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        label="Name (optional)"
                        autofocus
                        maxLength={MAX_LABEL_LENGTH}
                        value={label()}
                        onInput={(e) => setLabel(e.currentTarget.value)}
                    />
                    <PaperFlex direction="row" gap="half" align="end" fullWidth>
                        <PaperInput
                            fullWidth
                            label="Command"
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
            </PaperFlex>
        </PaperModal>
    );
}
