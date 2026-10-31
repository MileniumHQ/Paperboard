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
    saveWorld,
    getStatusBadge,
} from "../lib/server";
import ServerIssueModal from "./ServerIssueModal";
import RecoveryNotice from "./RecoveryNotice";
import { errorMessage } from "../lib/failure";

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
    /** false for a game with no console commands: the console only shows its output */
    commands?: boolean;
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
    const runCommand = (command: string) => {
        setCommandError("");
        sendServerCommand(command).catch((err) => setCommandError(errorMessage(err)));
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
                        <PaperButton onClick={() => void save()} disabled={saving()}>
                            <PaperIcon>save</PaperIcon>
                            {saving() ? "Saving..." : "Save world"}
                        </PaperButton>
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
                <PaperQuote variant="danger" icon="warning" title="Command not run" onDismiss={() => setCommandError("")}>
                    {commandError()}
                </PaperQuote>
            </Show>

            {props.children}

            <PaperSeparator />

            <PaperCard grow minHeight={0} padding="full">
                <PaperConsole
                    entries={serverEntries()}
                    onCommand={runCommand}
                    showInput={props.commands !== false}
                    placeholder="Enter command..."
                    prompt="chevron_right"
                />
            </PaperCard>

            <ServerIssueModal />
        </>
    );
}
