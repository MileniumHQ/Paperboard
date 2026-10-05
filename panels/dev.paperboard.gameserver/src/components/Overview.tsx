import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperIcon,
    PaperSeparator,
    PaperConsole,
    PaperPage,
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
    serverMotd,
    serverSoftware,
    serverVersion,
    loadServerConfig,
    initServerListeners,
    startServer,
    stopServer,
    restartServer,
    sendServerCommand,
    getStatusBadge,
} from "../lib/server";
import { SOFTWARE_NAMES } from "../lib/software";
import ServerIssueModal from "./ServerIssueModal";

export default function Overview() {
    const [copied, setCopied] = createSignal(false);

    onMount(() => {
        loadServerConfig();
        initServerListeners();
    });

    const handleCopyAddress = async () => {
        const addr = `${localIp()}:${serverPort()}`;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(addr);
            }
        } catch (err) {
            console.debug("[overview] clipboard write failed, falling back:", String(err));
            const textarea = document.createElement("textarea");
            textarea.value = addr;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const badge = () => getStatusBadge(serverStatus());

    return (
        <PaperPage fullWidth fullHeight gap="full">
            <PaperCard shrink={false}>
                <PaperFlex fullWidth padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                        <PaperFlex gap="onefourth">
                            <PaperFlex direction="row" gap="half" align="center">
                                <PaperText weight={700} size={8}>
                                    {localIp()}:{serverPort()}
                                </PaperText>
                                <PaperButton size="tiny"
                                    icon
                                    onClick={handleCopyAddress}
                                    title={copied() ? "Copied!" : "Copy address"}>
                                    {copied() ? "check" : "content_copy"}
                                </PaperButton>
                                <PaperBadge variant={badge().variant}>
                                    {badge().label}
                                </PaperBadge>
                            </PaperFlex>
                            <PaperText weight={400} size={4} color="text-subtle">
                                {serverMotd()}
                            </PaperText>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>

            <PaperFlex
                justify="space-between"
                direction="row"
                align="center"
                shrink={false}
            >
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
                        <PaperButton
                            variant="danger"
                            onClick={stopServer}
                            disabled={serverStatus() === "stopping"}>
                            <PaperIcon>stop</PaperIcon>
                            Stop
                        </PaperButton>
                    </Show>

                    <Show when={serverStatus() === "online"}>
                        <PaperButton variant="warning" onClick={restartServer}>
                            <PaperIcon>restart_alt</PaperIcon>
                            Restart
                        </PaperButton>
                    </Show>
                </PaperFlex>

                <PaperFlex direction="row" align="center" gap="onefourth">
                    <PaperBadge>{serverVersion()}</PaperBadge>
                    <PaperBadge>
                        {SOFTWARE_NAMES[serverSoftware()] || serverSoftware()}
                    </PaperBadge>
                </PaperFlex>
            </PaperFlex>

            <Show when={serverActionError()}>
                <PaperQuote variant="danger" icon="warning" title="Server action failed">
                    {serverActionError()}
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

            <ServerIssueModal />
        </PaperPage>
    );
}
