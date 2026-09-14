import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperContainer,
    PaperText,
    PaperButton,
    PaperIcon,
    PaperSeparator,
    PaperConsole,
    PaperBadge,
    PaperEffect,
    PaperQuote,
} from "@paperboard-dev/paperui";
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
import "../style.css";

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
        <PaperFlex fullHeight fullWidth padding="double" gap="threefourths">
            <PaperContainer style={{ "flex-shrink": 0 }}>
                <PaperFlex fullWidth padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center">
                        <PaperFlex gap="onefourth">
                            <PaperFlex direction="row" gap="half" align="center">
                                <PaperText weight={700} size={8}>
                                    {localIp()}:{serverPort()}
                                </PaperText>
                                <PaperButton
                                    icon
                                    tiny
                                    onClick={handleCopyAddress}
                                    title={copied() ? "Copied!" : "Copy address"}
                                >
                                    {copied() ? "check" : "content_copy"}
                                </PaperButton>
                                <PaperBadge variant={badge().variant}>
                                    {badge().label}
                                </PaperBadge>
                            </PaperFlex>
                            <PaperText weight={400} size={4} color="light-text">
                                {serverMotd()}
                            </PaperText>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperFlex
                justify="space-between"
                direction="row"
                align="center"
                style={{ "flex-shrink": 0 }}
            >
                <PaperFlex gap="half" direction="row" align="center">
                    <Show when={serverStatus() === "offline"}>
                        <PaperEffect>
                            <PaperButton compact onClick={startServer}>
                                <PaperIcon>power</PaperIcon>
                                Start
                            </PaperButton>
                        </PaperEffect>
                    </Show>

                    <Show when={serverStatus() !== "offline"}>
                        <PaperButton
                            variant="red"
                            compact
                            onClick={stopServer}
                            disabled={serverStatus() === "stopping"}
                        >
                            <PaperIcon>stop</PaperIcon>
                            Stop
                        </PaperButton>
                    </Show>

                    <Show when={serverStatus() === "online"}>
                        <PaperButton variant="yellow" compact onClick={restartServer}>
                            <PaperIcon>restart_alt</PaperIcon>
                            Restart
                        </PaperButton>
                    </Show>
                </PaperFlex>

                <PaperFlex direction="row" align="center" gap="onefourth" style={{ height: "fit-content" }}>
                    <PaperBadge>{serverVersion()}</PaperBadge>
                    <PaperBadge>
                        {SOFTWARE_NAMES[serverSoftware()] || serverSoftware()}
                    </PaperBadge>
                </PaperFlex>
            </PaperFlex>

            <Show when={serverActionError()}>
                <PaperQuote variant="red" icon="warning" title="Server action failed">
                    {serverActionError()}
                </PaperQuote>
            </Show>

            <PaperSeparator />

            <PaperFlex fullWidth style={{ flex: 1, "min-height": 0 }}>
                <PaperContainer style={{ flex: 1, height: "100%", "min-height": 0 }}>
                    <PaperFlex padding="full" fullHeight style={{ "min-height": 0 }}>
                        <PaperConsole
                            entries={serverEntries()}
                            onCommand={sendServerCommand}
                            placeholder="Enter command..."
                            prompt="chevron_right"
                        />
                    </PaperFlex>
                </PaperContainer>
            </PaperFlex>

            <ServerIssueModal />
        </PaperFlex>
    );
}
