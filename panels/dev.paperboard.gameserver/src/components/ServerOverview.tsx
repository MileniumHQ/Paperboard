import { createSignal, For, Index, onMount, Show, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperIcon,
    PaperConsole,
    PaperEmptyState,
    PaperCopyButton,
    PaperCard,
    PaperBadge,
    PaperEffect,
    PaperGrid,
    PaperQuote,
    PaperStatTile,
    createAction,
} from "@mileniumhq/paperui";
import { getStatusBadge, useServer } from "../lib/server";
import ServerIssueModal from "./ServerIssueModal";
import RecoveryNotice from "./RecoveryNotice";
import { errorMessage } from "../lib/failure";
import type { Control } from "../games/types";
import type { OverviewStats } from "./overviewStats";
import { joinPort } from "../core/portNames";

/** What a game's Overview says under the address, beside the button that edits it. */
export function EditableDetail(props: { edit: string; onEdit(): void; children: JSX.Element }) {
    return (
        <PaperFlex direction="row" gap="half" align="center">
            {props.children}
            <PaperButton size="tiny" icon onClick={props.onEdit} title={props.edit} aria-label={props.edit}>
                edit
            </PaperButton>
        </PaperFlex>
    );
}

/**
 * Every game's Overview: the address card, the power controls, Save world,
 * a running server's four readouts and the console. A game fills in its own
 * avatar, the line under the address, its readouts, extra buttons for a
 * running server and its notices.
 *
 * The console takes what height is left, and never less than a height of
 * its own: a short window or a phone has too little left under the rest,
 * so there the Overview scrolls as a whole.
 */
export default function ServerOverview(props: {
    avatar: JSX.Element;
    /** a line under the address; without one the address centers beside the avatar */
    detail?: JSX.Element;
    /** the software badge beside the version, such as "Paper" or "Vanilla" */
    software: string;
    /** a running server's readouts: one row of four equal tiles, or two rows of two where four don't fit */
    stats?: OverviewStats;
    /** buttons after Restart while the server is online */
    actions?: JSX.Element;
    /** notices between the controls and the console */
    children?: JSX.Element;
    /** what the console line does; console commands when left out */
    control?: Control;
    /** false for a game that keeps no world, which has no Save world */
    world?: boolean;
}) {
    const { calls, serverActionError, serverStatus, serverEntries, localIp, serverPort, portMoves, serverVersion, loadServerConfig, startServer, stopServer, restartServer } = useServer();
    // loading the config also reads the server's state
    onMount(() => void loadServerConfig());

    const saving = createAction({ message: errorMessage });
    const [commandError, setCommandError] = createSignal("");
    // resolves once the game confirms it wrote its world to disk
    const save = () => saving.run("World not saved", () => calls.saveWorld());
    const control = () => props.control?.kind ?? "stdin";
    const runCommand = (line: string) => {
        setCommandError("");
        const sent = control() === "broadcast" ? calls.sayChat({ message: line }) : calls.runCommand({ command: line });
        sent.catch((err) => setCommandError(errorMessage(err)));
    };

    const badge = () => getStatusBadge(serverStatus());
    const address = () => `${localIp()}:${joinPort({ serverPort: serverPort(), portMoves: portMoves() })}`;

    return (
        <PaperFlex direction="column" gap="full" grow minHeight={0} fullWidth overflowY="auto">
            <PaperCard shrink={false} padding="full">
                <PaperFlex direction="row" gap="threefourths" align="center">
                    {props.avatar}
                    <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                        <PaperFlex direction="row" gap="half" align="center" wrap>
                            <PaperText size={4} weight={700}>{address()}</PaperText>
                            <PaperCopyButton text={address()} title="Copy address" />
                        </PaperFlex>
                        {props.detail}
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            {/* both groups wrap, so a phone's controls and badges stack instead of leaving the screen */}
            <PaperFlex justify="space-between" direction="row" align="center" gap="half" wrap shrink={false}>
                <PaperFlex gap="half" direction="row" align="center" wrap>
                    <Show when={serverStatus() === "offline"}>
                        <PaperEffect>
                            <PaperButton onClick={startServer}>
                                <PaperIcon>power</PaperIcon>
                                Start
                            </PaperButton>
                        </PaperEffect>
                    </Show>
                    <Show when={serverStatus() !== "offline"}>
                        <PaperButton variant="danger" onClick={stopServer} disabled={serverStatus() === "stopping"}>
                            <PaperIcon>stop</PaperIcon>
                            Stop
                        </PaperButton>
                    </Show>
                    <Show when={serverStatus() === "online"}>
                        <PaperButton variant="warning" onClick={restartServer}>
                            <PaperIcon>restart_alt</PaperIcon>
                            Restart
                        </PaperButton>
                        <Show when={props.world !== false}>
                            <PaperButton onClick={() => void save()} disabled={saving.busy()}>
                                <PaperIcon>save</PaperIcon>
                                {saving.busy() ? "Saving..." : "Save world"}
                            </PaperButton>
                        </Show>
                        {props.actions}
                    </Show>
                </PaperFlex>
                <PaperFlex direction="row" align="center" gap="onefourth" wrap>
                    <PaperBadge variant={badge().variant}>{badge().label}</PaperBadge>
                    <PaperBadge>{serverVersion()}</PaperBadge>
                    <PaperBadge>{props.software}</PaperBadge>
                </PaperFlex>
            </PaperFlex>

            <Show when={serverStatus() === "online" && props.stats}>
                {(stats) => (
                    // two pairs: side by side when all four fit, else one over the other, never three and one
                    <PaperGrid fit min="card-min">
                        <Index each={[stats().slice(0, 2), stats().slice(2)]}>
                            {(pair) => (
                                <PaperGrid columns={2}>
                                    {/* by position: the uptime's tick makes four new readouts every second, and each tile stays */}
                                    <Index each={pair()}>
                                        {(stat) => <PaperStatTile icon={stat().icon} label={stat().label} value={stat().value} tone={stat().tone} />}
                                    </Index>
                                </PaperGrid>
                            )}
                        </Index>
                    </PaperGrid>
                )}
            </Show>

            <RecoveryNotice />

            {/* a taken port moved for this run alone: friends must join on the new one */}
            <For each={portMoves()}>
                {(move) => (
                    <PaperQuote variant="warning" icon="swap_horiz" title={`${move.primary ? "Port" : `${move.label} port`} ${move.from} was taken, so this run uses ${move.to}`}>
                        {move.primary ? `Players join on ${move.to} until the server stops.` : `It uses ${move.to} until the server stops.`} The next start asks for {move.from} again.
                    </PaperQuote>
                )}
            </For>

            <Show when={serverActionError()}>
                <PaperQuote variant="danger" icon="warning" title="Server action failed">
                    {serverActionError()}
                </PaperQuote>
            </Show>

            <Show when={saving.error()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="warning" title={failure().title} onDismiss={() => saving.setError(null)}>
                        {failure().message}
                    </PaperQuote>
                )}
            </Show>

            <Show when={commandError()}>
                <PaperQuote variant="danger" icon="warning" title={control() === "broadcast" ? "Message not sent" : "Command not run"} onDismiss={() => setCommandError("")}>
                    {commandError()}
                </PaperQuote>
            </Show>

            {props.children}

            <PaperCard grow minHeight="field-wide" padding="full">
                <PaperConsole
                    entries={serverEntries()}
                    onCommand={runCommand}
                    showInput={control() !== "none"}
                    placeholder={control() === "broadcast" ? "Message everyone on the server..." : "Enter command..."}
                    prompt={control() === "broadcast" ? "campaign" : "chevron_right"}
                    empty={
                        <PaperEmptyState
                            icon="terminal"
                            title={serverStatus() === "offline" ? "The server is stopped" : "Nothing printed yet"}
                            description={serverStatus() === "offline" ? "Start it and what it prints shows up here." : "What the server prints shows up here."}
                        />
                    }
                />
            </PaperCard>

            <ServerIssueModal />
        </PaperFlex>
    );
}
