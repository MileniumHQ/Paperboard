import { createEffect, createSignal, on, onMount, Show } from "solid-js";
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
import { fileApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/contract";
import { parseProperties } from "../core/properties";
import { whitelistDefault } from "../lib/properties";
import { countJsonEntries, joinRestriction, type JoinRestriction } from "../core/whitelist";

export default function Overview(props: {
    /** true while this tab is shown: the whitelist check re-runs then */
    active: boolean;
    /** opens another tab of the panel */
    onOpenTab: (tab: "players" | "advanced") => void;
    /** whether this version has a Players tab */
    hasPlayersTab: boolean;
}) {
    const [copied, setCopied] = createSignal(false);
    const [restriction, setRestriction] = createSignal<JoinRestriction>(null);

    // the whitelist can lock everyone but operators out, and 26.3 turns it
    // on for new servers; say so where people look when friends can't join
    const checkWhitelist = async () => {
        try {
            const [properties, whitelist, ops] = await Promise.all([
                fileApi.read("server.properties", PANEL_ID),
                fileApi.read("whitelist.json", PANEL_ID),
                fileApi.read("ops.json", PANEL_ID),
            ]);
            const on = (properties ? parseProperties(properties)["white-list"] : undefined) ?? whitelistDefault();
            setRestriction(joinRestriction(on === "true", countJsonEntries(whitelist), countJsonEntries(ops)));
        } catch (err) {
            // unreadable files make no claim either way
            console.debug("[overview] whitelist check failed:", String(err));
            setRestriction(null);
        }
    };
    createEffect(
        on([() => props.active, serverStatus, serverVersion], ([active]) => {
            if (active) void checkWhitelist();
        }),
    );

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

            <Show when={restriction()}>
                <PaperQuote variant="warning" icon="lock" title="Whitelist is on">
                    <PaperFlex direction="column" gap="half">
                        <span>
                            {restriction() === "operators-only"
                                ? "Nobody is on the whitelist, so only operators can join."
                                : "Nobody is on the whitelist, so no one can join."}{" "}
                            Add players to the whitelist, or turn it off in Advanced.
                        </span>
                        <PaperFlex direction="row" gap="half">
                            <Show when={props.hasPlayersTab}>
                                <PaperButton onClick={() => props.onOpenTab("players")}>Add players</PaperButton>
                            </Show>
                            <PaperButton onClick={() => props.onOpenTab("advanced")}>Open Advanced</PaperButton>
                        </PaperFlex>
                    </PaperFlex>
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
