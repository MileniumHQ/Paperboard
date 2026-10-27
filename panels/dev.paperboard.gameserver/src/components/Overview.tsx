import { createEffect, createSignal, on, onMount, Show } from "solid-js";
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
import RecoveryNotice from "./RecoveryNotice";
import { MotdEditor, MotdPreview } from "./Motd";
import { fileApi } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/contract";
import { parseProperties } from "../core/properties";
import { whitelistDefault } from "../lib/properties";
import { countJsonEntries, joinRestriction, type JoinRestriction } from "../core/whitelist";

export default function Overview(props: {
    /** true while this tab is shown: the whitelist check re-runs then */
    active: boolean;
    /** opens another tab of the panel */
    onOpenTab: (tab: "players" | "options") => void;
    /** whether this version has a Players tab */
    hasPlayersTab: boolean;
}) {
    const [motdOpen, setMotdOpen] = createSignal(false);
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

    const badge = () => getStatusBadge(serverStatus());

    return (
        <>
            <PaperCard shrink={false} padding="full" gap="onefourth">
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperText weight={700} size={8}>
                        {localIp()}:{serverPort()}
                    </PaperText>
                    <PaperCopyButton text={`${localIp()}:${serverPort()}`} title="Copy address" />
                    <PaperBadge variant={badge().variant}>
                        {badge().label}
                    </PaperBadge>
                </PaperFlex>
                <PaperFlex direction="row" gap="half" align="center">
                    <MotdPreview motd={serverMotd()} />
                    <PaperButton size="tiny"
                        icon
                        onClick={() => setMotdOpen(true)}
                        title="Edit server list message"
                        aria-label="Edit server list message">
                        edit
                    </PaperButton>
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

            <RecoveryNotice />

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
                            Add players to the whitelist, or turn it off in Options.
                        </span>
                        <PaperFlex direction="row" gap="half">
                            <Show when={props.hasPlayersTab}>
                                <PaperButton onClick={() => props.onOpenTab("players")}>Add players</PaperButton>
                            </Show>
                            <PaperButton onClick={() => props.onOpenTab("options")}>Open Options</PaperButton>
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

            <MotdEditor open={motdOpen()} onClose={() => setMotdOpen(false)} />
            <ServerIssueModal />
        </>
    );
}
