import { createSignal, onMount, Show, type JSX } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperIcon,
    PaperSeparator,
    PaperConsole,
    PaperCopyButton,
    PaperCard,
    PaperBadge,
    PaperEffect,
    PaperQuote,
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
 * Every game's Overview: the address card, the power controls, Save world
 * and the console. A game fills in its own avatar, the line under the address,
 * extra buttons for a running server and its notices.
 */
export default function ServerOverview(props: {
    avatar: JSX.Element;
    /** a line under the address; without one the address centers beside the avatar */
    detail?: JSX.Element;
    /** the software badge beside the version, such as "Paper" or "Vanilla" */
    software: string;
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

    const badge = () => getStatusBadge(serverStatus());
    const address = () => `${localIp()}:${serverPort()}`;

    return (
        <>
            <PaperCard shrink={false} padding="full">
                <PaperFlex direction="row" gap="full" align="center">
                    {props.avatar}
                    <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperText preset="title">{address()}</PaperText>
                            <PaperCopyButton text={address()} title="Copy address" />
                            <PaperBadge variant={badge().variant}>{badge().label}</PaperBadge>
                        </PaperFlex>
                        {props.detail}
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperFlex justify="space-between" direction="row" align="center" shrink={false}>
                <PaperFlex gap="half" direction="row" align="center">
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
                <PaperFlex direction="row" align="center" gap="onefourth">
                    <PaperBadge>{serverVersion()}</PaperBadge>
                    <PaperBadge>{props.software}</PaperBadge>
                </PaperFlex>
            </PaperFlex>

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

            <PaperCard grow minHeight={0} padding="full">
                <PaperConsole
                    entries={serverEntries()}
                    onCommand={runCommand}
                    showInput={control() !== "none"}
                    placeholder={control() === "broadcast" ? "Message everyone on the server..." : "Enter command..."}
                    prompt={control() === "broadcast" ? "campaign" : "chevron_right"}
                />
            </PaperCard>

            <ServerIssueModal />
        </>
    );
}
