import { createSignal, onMount, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperConsole,
    PaperCopyButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperQuote,
    PaperSeparator,
    PaperText,
} from "@mileniumhq/paperui";
import {
    getStatusBadge,
    initServerListeners,
    localIp,
    restartServer,
    sendServerCommand,
    serverActionError,
    serverBridge,
    serverEntries,
    serverPort,
    serverStatus,
    serverVersion,
    startServer,
    stopServer,
} from "../../lib/server";
import { errorMessage } from "../../lib/failure";

export default function TerrariaOverview() {
    const [saving, setSaving] = createSignal(false);
    const [saveError, setSaveError] = createSignal("");
    const badge = () => getStatusBadge(serverStatus());
    const address = () => `${localIp()}:${serverPort()}`;

    onMount(() => void initServerListeners());

    const save = async () => {
        setSaving(true);
        setSaveError("");
        try {
            await serverBridge.call("terraria-save", undefined, { timeoutMs: null });
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <PaperCard shrink={false} padding="full">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperAvatar size="xlarge" shape="square" alt="Terraria" fallbackIcon="landscape" />
                    <PaperFlex direction="column" gap="onefourth" minWidth={0}>
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperText preset="title">{address()}</PaperText>
                            <PaperCopyButton text={address()} title="Copy address" />
                            <PaperBadge variant={badge().variant}>{badge().label}</PaperBadge>
                        </PaperFlex>
                        <PaperText>Players join from Multiplayer, then Join via IP.</PaperText>
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
                            Save world
                        </PaperButton>
                    </Show>
                </PaperFlex>
                <PaperFlex direction="row" align="center" gap="onefourth">
                    <PaperBadge>{serverVersion()}</PaperBadge>
                    <PaperBadge>Vanilla</PaperBadge>
                </PaperFlex>
            </PaperFlex>

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

            <PaperSeparator />

            <PaperCard grow minHeight={0} padding="full">
                <PaperConsole
                    entries={serverEntries()}
                    onCommand={sendServerCommand}
                    placeholder="Enter command..."
                    prompt="chevron_right"
                />
            </PaperCard>
        </>
    );
}
