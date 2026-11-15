import { createSignal, For, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSeparator,
    PaperText,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { callsFor, panelCalls } from "../lib/api";
import type { ServerSummary, ServersState } from "../service";
import { gameFor, games, serverSubtitle } from "../games";
import GamePicker from "./GamePicker";
import { SERVER_NAME_MAX } from "../servers";
import { errorMessage } from "../lib/failure";
export default function ServersHome(props: {
    state: ServersState;
    /** opens a server; on a phone its page slides in first */
    onOpen: (id: string) => void;
}) {
    const [dialog, setDialog] = createSignal<"add" | "rename" | "remove" | null>(null);
    const [target, setTarget] = createSignal<ServerSummary | null>(null);
    const [name, setName] = createSignal("");
    // a new server starts by choosing its game, then gets its name
    const [game, setGame] = createSignal<string | null>(null);
    // the name modal keeps its title while it fades out after Back
    const [named, setNamed] = createSignal<string>(games[0].id);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const menu = useContextMenuState("below-right");
    const ask = (kind: "add" | "rename" | "remove") => {
        menu.close();
        setName(kind === "rename" ? target()!.name : "");
        setGame(null);
        setError("");
        setDialog(kind);
    };
    const choosingGame = () => dialog() === "add" && game() === null;
    const submit = async () => {
        if (busy()) return;
        setBusy(true);
        setError("");
        try {
            const kind = dialog();
            if (kind === "add") {
                const chosen = game();
                if (chosen === null) throw new Error("Choose a game for the server");
                const added = await panelCalls.addServer({ name: name(), game: chosen });
                setDialog(null);
                setBusy(false);
                props.onOpen(added.id);
                return;
            }
            const server = callsFor(target()!.id);
            if (kind === "rename") await server.renameServer({ name: name() });
            else await server.removeServer();
            setDialog(null);
            setBusy(false);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };
    const newServer = () => (
        <PaperEffect variant="success">
            <PaperButton variant="success" disabled={Boolean(props.state.serversError)} onClick={() => ask("add")}>
                <PaperIcon>add</PaperIcon>
                New server
            </PaperButton>
        </PaperEffect>
    );

    return (
        <PaperFlex fullWidth fullHeight overflowY="auto">
            <PaperPage width="wide">
                <PaperPageHeader icon="dns" title="Servers">
                    {/* an empty page offers this in its empty state instead */}
                    <Show when={props.state.servers.length > 0}>{newServer()}</Show>
                </PaperPageHeader>
                <Show when={props.state.serversError}>
                    {(error) => (
                        <PaperQuote variant="danger" title="Servers could not be read" role="alert">
                            {error()}
                        </PaperQuote>
                    )}
                </Show>
                <Show
                    when={props.state.servers.length}
                    fallback={
                        <PaperEmptyState
                            icon="dns"
                            title="No servers yet"
                            description="Choose a game, set up a server, and invite your friends."
                        >
                            {newServer()}
                        </PaperEmptyState>
                    }
                >
                    <PaperMediaCardGroup minCardWidth="card-min">
                        <For each={props.state.servers}>
                            {(server) => (
                                <PaperMediaCard
                                    effect={false}
                                    banner={gameFor(server.game).art.banner}
                                    bannerAlt={`${gameFor(server.game).name} art`}
                                    icon={<PaperAvatar size="large" shape="square" src={server.icon ?? gameFor(server.game).art.icon} alt="" fallbackIcon={gameFor(server.game).icon} />}
                                    title={server.name}
                                    subtitle={serverSubtitle(gameFor(server.game), { software: server.state.serverSoftware, version: server.state.serverVersion })}
                                    description={
                                        server.state.initFailure ??
                                        server.state.recoveryBlock ??
                                        (!server.configured ? "Finish setup" : undefined)
                                    }
                                    badge={
                                        <PaperBadge
                                            variant={
                                                server.state.initFailure ?? server.state.recoveryBlock
                                                    ? "danger"
                                                    : server.state.serverStatus === "online"
                                                      ? "success"
                                                      : "monochrome"
                                            }
                                        >
                                            {server.state.initFailure ?? server.state.recoveryBlock
                                                ? "Error"
                                                : server.state.serverStatus}
                                        </PaperBadge>
                                    }
                                    onClick={() => props.onOpen(server.id)}
                                    footerLeft={
                                        <Show when={server.configured && server.state.serverPort}>
                                            {(port) => (
                                                <PaperText size={2} color="text-subtle">
                                                    Port {port()}
                                                    <Show when={server.state.serverStatus === "online"}>
                                                        {` · ${server.state.playerCount}${server.state.maxPlayers === null ? "" : `/${server.state.maxPlayers}`} ${server.state.playerCount === 1 && server.state.maxPlayers === null ? "player" : "players"}`}
                                                    </Show>
                                                </PaperText>
                                            )}
                                        </Show>
                                    }
                                    footerRight={
                                        <PaperButton
                                            icon
                                            variant="text"
                                            title="More"
                                            aria-label={`More for ${server.name}`}
                                            onClick={(e) => {
                                                setTarget(server);
                                                menu.openBelow(e, { align: "right" });
                                            }}
                                        >
                                            <PaperIcon>more_vert</PaperIcon>
                                        </PaperButton>
                                    }
                                />
                            )}
                        </For>
                    </PaperMediaCardGroup>
                </Show>
            </PaperPage>
            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuItem icon="open_in_new" onClick={() => props.onOpen(target()!.id)}>
                    Open
                </PaperContextMenuItem>
                <PaperContextMenuItem icon="edit" onClick={() => ask("rename")}>
                    Rename
                </PaperContextMenuItem>
                <PaperSeparator role="separator" />
                <PaperContextMenuItem icon="delete" danger onClick={() => ask("remove")}>
                    Remove
                </PaperContextMenuItem>
            </PaperContextMenu>
            <PaperModal
                open={dialog() === "add"}
                onClose={() => {
                    if (!busy()) setDialog(null);
                }}
                size="full"
                title="Choose a game"
            >
                <GamePicker
                    games={games}
                    onPick={(id) => {
                        setName("");
                        setError("");
                        setNamed(id);
                        setGame(id);
                    }}
                />
            </PaperModal>
            {/* opens over the picker; Back returns to it */}
            <PaperModal
                open={dialog() !== null && !choosingGame()}
                onClose={() => {
                    if (busy()) return;
                    if (dialog() === "add") setGame(null);
                    else setDialog(null);
                }}
                title={
                    dialog() === "add"
                        ? `New ${gameFor(named()).name} server`
                        : dialog() === "rename"
                          ? "Rename server"
                          : `Remove ${target()?.name ?? "server"}?`
                }
                footer={
                    <>
                        <Show when={dialog() !== "add"}>
                            <PaperButton variant="text" disabled={busy()} onClick={() => setDialog(null)}>
                                Cancel
                            </PaperButton>
                        </Show>
                        <PaperButton
                            disabled={busy() || (dialog() !== "remove" && !name().trim())}
                            onClick={() => void submit()}
                        >
                            {dialog() === "add"
                                ? "Continue to setup"
                                : dialog() === "remove"
                                  ? "Remove server"
                                  : "Save name"}
                        </PaperButton>
                    </>
                }
            >
                <Show when={error()}>
                    {(error) => (
                        <PaperQuote
                            variant="danger"
                            title={
                                dialog() === "add"
                                    ? "Server could not be added"
                                    : dialog() === "remove"
                                      ? "Server could not be removed"
                                      : "Server could not be renamed"
                            }
                            role="alert"
                        >
                            {error()}
                        </PaperQuote>
                    )}
                </Show>
                <Show
                    when={dialog() !== "remove"}
                    fallback={
                        <PaperText>
                            The server will stop and leave this list and Blocks. Its files and
                            backups will be kept.
                        </PaperText>
                    }
                >
                    <PaperInput
                        fullWidth
                        autofocus
                        label="Server name"
                        maxLength={SERVER_NAME_MAX}
                        value={name()}
                        onInput={(e) => setName(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && name().trim() && !busy()) void submit();
                        }}
                    />
                </Show>
            </PaperModal>
        </PaperFlex>
    );
}
