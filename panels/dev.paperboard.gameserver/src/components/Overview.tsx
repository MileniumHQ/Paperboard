import { minecraftSoftware } from "../games/minecraft/index";
import { createMemo, createSignal, Show } from "solid-js";
import {
    PaperFlex,
    PaperButton,
    PaperQuote,
    PaperAvatar,
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
    createRead,
    showError,
} from "@mileniumhq/paperui";
import { useServer } from "../lib/server";
import { createUptime, overviewStats } from "./overviewStats";
import { SOFTWARE_NAMES } from "../lib/software";
import ServerOverview from "./ServerOverview";
import { MotdEditor, MotdPreview } from "./Motd";
import { PANEL_ID } from "../service/contract";
import { parseProperties } from "../core/properties";
import { readServerPropertiesStrict, whitelistDefault, writeServerProperties } from "../lib/properties";
import { DEFAULT_MOTD, minecraftMotd } from "../core/motd";
import { countJsonEntries, joinRestriction, type JoinRestriction } from "../core/whitelist";
import { setServerIconFromFile } from "../lib/serverIcon";
import { errorMessage } from "../lib/failure";

export default function Overview(props: {
    /** true while this tab is shown: the whitelist check re-runs then */
    active: boolean;
    /** opens another tab of the panel */
    onOpenTab: (tab: "players" | "options") => void;
    /** whether this version has a Players tab */
    hasPlayersTab: boolean;
}) {
    const { calls, files, ramAllocation, serverStatus, serverMotd, serverSoftware, serverVersion, loadServerConfig } = useServer();
    const [motdOpen, setMotdOpen] = createSignal(false);
    const uptime = createUptime();

    // the whitelist can lock everyone but operators out, and 26.3 turns it
    // on for new servers; say so where people look when friends can't join.
    // Checked again whenever the tab is shown, and the server starts, stops or changes version
    const whitelist = createRead(
        async () => {
            const [properties, list, ops] = await Promise.all([
                files.read("server.properties", PANEL_ID),
                files.read("whitelist.json", PANEL_ID),
                files.read("ops.json", PANEL_ID),
            ]);
            const parsed = properties ? parseProperties(properties) : {};
            const on = parsed["white-list"] ?? whitelistDefault(serverVersion());
            return { world: parsed["level-name"] || "world", restriction: joinRestriction(on === "true", countJsonEntries(list), countJsonEntries(ops)) };
        },
        { source: () => props.active && [serverStatus(), serverVersion()], message: errorMessage, failure: { title: "Couldn't check the whitelist" } },
    );
    // unreadable files make no claim either way, and say so
    const restriction = (): JoinRestriction => (whitelist.error() === null ? (whitelist.value()?.restriction ?? null) : null);
    // the world the server runs: server.properties' level-name, "world" when it names none
    const world = createMemo((prev: string) => whitelist.value()?.world ?? prev, "world");

    // the server list icon: the avatar's edit button opens the file picker,
    // and a right click offers to change or remove it
    const iconRead = createRead(() => calls.readServerIcon(), { message: errorMessage, failure: { title: "Couldn't read the server icon" } });
    const icon = () => iconRead.value() ?? null;
    let iconPicker!: HTMLInputElement;

    const changeIcon = async (file: File | undefined) => {
        if (!file) return;
        try {
            iconRead.set(await setServerIconFromFile(calls, file));
        } catch (err) {
            showError("Couldn't change the server icon", errorMessage(err));
        }
    };

    const iconMenu = useContextMenuState("mouse");
    const removeIcon = async () => {
        iconMenu.close();
        try {
            await calls.removeServerIcon();
            iconRead.set(null);
        } catch (err) {
            showError("Couldn't remove the server icon", errorMessage(err));
        }
    };

    return (
        <ServerOverview
            stats={overviewStats(
                uptime(),
                { icon: "public", label: "World", value: world() },
                { icon: "memory", label: "Memory limit", value: `${ramAllocation()} GB` },
            )}
            avatar={
                <>
                    <PaperAvatar
                        size="xlarge"
                        shape="square"
                        src={icon() ?? undefined}
                        alt="Server icon"
                        fallbackIcon="image"
                        editLabel="Change server icon"
                        onEdit={() => iconPicker.click()}
                        onContextMenu={iconMenu.openAtCursor}
                    />
                    <PaperContextMenu open={iconMenu.isOpen()} target={iconMenu.target()} placement={iconMenu.placement()} onClose={iconMenu.close}>
                        <PaperContextMenuItem
                            icon="image"
                            onClick={() => {
                                iconMenu.close();
                                iconPicker.click();
                            }}
                        >
                            Change
                        </PaperContextMenuItem>
                        <PaperContextMenuItem icon="delete" danger disabled={icon() === null} onClick={() => void removeIcon()}>
                            Remove
                        </PaperContextMenuItem>
                    </PaperContextMenu>
                    <input
                        ref={iconPicker}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                            void changeIcon(e.currentTarget.files?.[0]);
                            e.currentTarget.value = "";
                        }}
                    />
                </>
            }
            detail={
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
            }
            software={SOFTWARE_NAMES[minecraftSoftware(serverSoftware())] || minecraftSoftware(serverSoftware())}
        >
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

            <MotdEditor
                open={motdOpen()}
                onClose={() => setMotdOpen(false)}
                dialect={minecraftMotd}
                title="Server list message"
                source="server.properties"
                load={async () => (await readServerPropertiesStrict(files)).motd ?? DEFAULT_MOTD}
                save={async (motd) => {
                    await writeServerProperties(files, { motd });
                    await loadServerConfig();
                }}
            />
        </ServerOverview>
    );
}
