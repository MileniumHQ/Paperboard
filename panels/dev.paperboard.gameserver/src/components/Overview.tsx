import { minecraftSoftware } from "../games/minecraft/index";
import { createEffect, createSignal, on, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperButton,
    PaperQuote,
    PaperAvatar,
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { serverStatus, serverMotd, serverSoftware, serverVersion, loadServerConfig } from "../lib/server";
import { SOFTWARE_NAMES } from "../lib/software";
import ServerOverview from "./ServerOverview";
import { MotdEditor, MotdPreview } from "./Motd";
import { fileApi } from "../lib/api";
import { PANEL_ID } from "../service/contract";
import { parseProperties } from "../core/properties";
import { readServerPropertiesStrict, whitelistDefault, writeServerProperties } from "../lib/properties";
import { DEFAULT_MOTD, minecraftMotd } from "../core/motd";
import { countJsonEntries, joinRestriction, type JoinRestriction } from "../core/whitelist";
import { readServerIcon, removeServerIcon, setServerIconFromFile } from "../lib/serverIcon";
import { errorMessage } from "../lib/failure";

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

    // the server list icon: the avatar's edit button opens the file picker,
    // and a right click offers to change or remove it
    const [icon, setIcon] = createSignal<string | null>(null);
    const [iconError, setIconError] = createSignal<{ title: string; message: string } | null>(null);
    let iconPicker!: HTMLInputElement;

    const loadIcon = async () => {
        try {
            setIcon(await readServerIcon());
        } catch (err) {
            setIconError({ title: "Couldn't read the server icon", message: errorMessage(err) });
        }
    };

    const changeIcon = async (file: File | undefined) => {
        if (!file) return;
        setIconError(null);
        try {
            setIcon(await setServerIconFromFile(file));
        } catch (err) {
            setIconError({ title: "Server icon not changed", message: errorMessage(err) });
        }
    };

    const iconMenu = useContextMenuState("mouse");
    const removeIcon = async () => {
        iconMenu.close();
        setIconError(null);
        try {
            await removeServerIcon();
            setIcon(null);
        } catch (err) {
            setIconError({ title: "Server icon not removed", message: errorMessage(err) });
        }
    };

    onMount(() => void loadIcon());

    return (
        <ServerOverview
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
            <Show when={iconError()}>
                {(error) => (
                    <PaperQuote variant="danger" icon="warning" title={error().title} onDismiss={() => setIconError(null)}>
                        {error().message}
                    </PaperQuote>
                )}
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

            <MotdEditor
                open={motdOpen()}
                onClose={() => setMotdOpen(false)}
                dialect={minecraftMotd}
                title="Server list message"
                source="server.properties"
                load={async () => (await readServerPropertiesStrict()).motd ?? DEFAULT_MOTD}
                save={async (motd) => {
                    await writeServerProperties({ motd });
                    await loadServerConfig();
                }}
            />
        </ServerOverview>
    );
}
