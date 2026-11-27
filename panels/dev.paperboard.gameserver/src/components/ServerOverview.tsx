import { createEffect, createSignal, For, Index, on, Show, type JSX } from "solid-js";
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
    PaperModal,
    createAction,
    showError,
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
 * Every game's Overview: the address card, the power controls, Save,
 * a running server's four readouts and the console. A game fills in its own
 * avatar, the line under the address, its readouts, extra buttons for a
 * running server and its notices.
 *
 * The console takes what height is left, and never less than a height of
 * its own: a short window or a phone has too little left under the rest,
 * so there the rest scrolls above it, and the console and its command line
 * stay in view.
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
    /** false for a game that keeps no world, which has no Save */
    world?: boolean;
}) {
    const { calls, summary, serverStatus, serverEntries, onlinePlayers, localIp, serverPort, portMoves, serverVersion, initFailure, loadServerConfig, startServer, stopServer, restartServer } = useServer();
    // loading the config also reads the server's state; a server that isn't
    // set up has none to load (RecoveryNotice says why), and loads it once it is
    createEffect(
        on(
            () => initFailure() === null,
            (ready) => {
                if (ready) void loadServerConfig();
            },
        ),
    );

    const saving = createAction({ message: errorMessage });
    // resolves once the game confirms it wrote its world to disk
    const save = () => saving.run("Couldn't save the world", () => calls.saveWorld());
    const control = () => props.control?.kind ?? "stdin";
    // a line typed that didn't go out says why, once
    const runCommand = (line: string) => {
        const broadcast = control() === "broadcast";
        const sent = broadcast ? calls.sayChat({ message: line }) : calls.runCommand({ command: line });
        sent.catch((err) => showError(broadcast ? "Couldn't send the message" : "Couldn't run the command", errorMessage(err)));
    };

    // stopping disconnects whoever is playing, so with anyone on it asks first
    const [askStop, setAskStop] = createSignal(false);
    const playing = () => onlinePlayers().length;
    const stop = () => (playing() > 0 ? setAskStop(true) : stopServer());
    // the question of stopping it says nothing once that state is gone
    createEffect(on(serverStatus, () => setAskStop(false), { defer: true }));
    const badge = () => getStatusBadge(serverStatus());
    const address = () => `${localIp()}:${joinPort({ serverPort: serverPort(), portMoves: portMoves() })}`;

    return (
        <PaperFlex direction="column" gap="full" grow minHeight={0} fullWidth>
            <PaperFlex direction="column" gap="full" minHeight={0} fullWidth overflowY="auto">
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
                            <PaperButton variant="danger" onClick={stop} disabled={serverStatus() === "stopping"}>
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
                                    {saving.busy() ? "Saving..." : "Save"}
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
                    {(move) => {
                        // ports in a row move together: "Ports 2456–2457 were taken, so this run uses 2460–2461"
                        const span = (from: number) => ((move.count ?? 1) > 1 ? `${from}–${from + move.count! - 1}` : String(from));
                        const what = (move.count ?? 1) > 1 ? `${move.primary ? "Ports" : `${move.label} ports`} ${span(move.from)} were` : `${move.primary ? "Port" : `${move.label} port`} ${move.from} was`;
                        return (
                            <PaperQuote variant="warning" icon="swap_horiz" title={`${what} taken, so this run uses ${span(move.to)}`}>
                                {move.primary ? `Players join on ${move.to} until the server stops.` : `It uses ${span(move.to)} until the server stops.`} The next start asks for {span(move.from)} again.
                            </PaperQuote>
                        );
                    }}
                </For>

                {props.children}
            </PaperFlex>

            <PaperCard flex minHeight="field-wide" padding="full">
                <PaperConsole
                    entries={serverEntries()}
                    onCommand={runCommand}
                    showInput={control() !== "none"}
                    placeholder={control() === "broadcast" ? "Message" : "Command"}
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

            <PaperModal
                open={askStop()}
                title={`Stop ${summary().name}?`}
                size="small"
                onClose={() => setAskStop(false)}
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setAskStop(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" onClick={() => { setAskStop(false); stopServer(); }}>Stop</PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {playing() === 1 ? "1 player is" : `${playing()} players are`} online. Stopping the server disconnects them.
                </PaperText>
            </PaperModal>

            <ServerIssueModal />
        </PaperFlex>
    );
}
