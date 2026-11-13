import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperIcon,
    PaperSeparator,
    PaperConsole,
    PaperEmptyState,
    PaperCopyButton,
    PaperCard,
    PaperBadge,
    PaperEffect,
    PaperGrid,
    PaperQuote,
    PaperStatTile,
} from "@mileniumhq/paperui";
import {
    serverActionError,
    serverStatus,
    serverEntries,
    localIp,
    serverPort,
    serverVersion,
    loadServerConfig,
    initServerListeners,
    startServer,
    stopServer,
    restartServer,
    sendServerCommand,
    sendChatMessage,
    saveWorld,
    getStatusBadge,
} from "../lib/server";
import ServerIssueModal from "./ServerIssueModal";
import RecoveryNotice from "./RecoveryNotice";
import { errorMessage } from "../lib/failure";
import type { Control } from "../games/types";
import { createCompact } from "../lib/compact";
import type { OverviewStats } from "./overviewStats";

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
 * The console takes what height is left. A phone has none left under the
 * rest, so there the Overview is a page that scrolls as a whole (its tab's
 * compactVariant) and the console keeps a height of its own.
 */
export default function ServerOverview(props: {
    avatar: JSX.Element;
    /** a line under the address; without one the address centers beside the avatar */
    detail?: JSX.Element;
    /** the software badge beside the version, such as "Paper" or "Vanilla" */
    software: string;
    /** a running server's readouts, in one row of four equal tiles (two rows of two on a phone) */
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
    onMount(() => {
        void loadServerConfig();
        void initServerListeners();
    });

    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal("");
    const [commandError, setCommandError] = createSignal("");
    const save = async () => {
        setSaving(true);
        setSaveError("");
        try {
            await saveWorld();
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };
    const control = () => props.control?.kind ?? "stdin";
    const runCommand = (line: string) => {
        setCommandError("");
        const sent = control() === "broadcast" ? sendChatMessage(line) : sendServerCommand(line);
        sent.catch((err) => setCommandError(errorMessage(err)));
    };

    const compact = createCompact();
    const badge = () => getStatusBadge(serverStatus());
    const address = () => `${localIp()}:${serverPort()}`;

    return (
        <PaperFlex direction="column" gap="full" grow minHeight={0} fullWidth>
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
                            <PaperButton onClick={() => void save()} disabled={saving()}>
                                <PaperIcon>save</PaperIcon>
                                {saving() ? "Saving..." : "Save world"}
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
                    <PaperGrid columns={compact() ? 2 : 4}>
                        <For each={stats()}>
                            {(stat) => <PaperStatTile icon={stat.icon} label={stat.label} value={stat.value} tone={stat.tone} />}
                        </For>
                    </PaperGrid>
                )}
            </Show>

            <RecoveryNotice />

            <Show when={serverActionError()}>
                <PaperQuote variant="danger" icon="warning" title="Server action failed">
                    {serverActionError()}
                </PaperQuote>
            </Show>

            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="World not saved" onDismiss={() => setSaveError("")}>
                    {saveError()}
                </PaperQuote>
            </Show>

            <Show when={commandError()}>
                <PaperQuote variant="danger" icon="warning" title={control() === "broadcast" ? "Message not sent" : "Command not run"} onDismiss={() => setCommandError("")}>
                    {commandError()}
                </PaperQuote>
            </Show>

            {props.children}

            <PaperSeparator />

            <PaperCard grow={!compact()} shrink={!compact()} minHeight={0} height={compact() ? "panel-height-small" : undefined} padding="full">
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
