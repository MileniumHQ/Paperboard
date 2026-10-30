import { createSignal, For, Show } from "solid-js";
import {
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
import { serversBridge, openServer } from "../lib/api";
import type { ServerSummary, ServersState } from "../service";
import GamePicker from "./GamePicker";
import { games, defaultGame, gameFor } from "../games";
export default function ServersHome(props: { state: ServersState }) {
    const [game, setGame] = createSignal(defaultGame.id);
    const [dialog, setDialog] = createSignal<"add" | "rename" | "remove" | null>(null);
    const [target, setTarget] = createSignal<ServerSummary | null>(null);
    const [name, setName] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const menu = useContextMenuState("below-right");
    const ask = (kind: "add" | "rename" | "remove") => {
        menu.close();
        setName(kind === "rename" ? target()!.name : "");
        setError("");
        setDialog(kind);
    };
    const submit = async () => {
        if (busy()) return;
        setBusy(true);
        setError("");
        try {
            const kind = dialog();
            if (kind === "add") {
                const added = await serversBridge.call<{ id: string }>("add-server", {
                    name: name(),
                    game: game(),
                });
                openServer(added.id);
            } else {
                await serversBridge.call(kind === "rename" ? "rename-server" : "remove-server", {
                    server: target()!.id,
                    name: name(),
                });
                setDialog(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperFlex fullWidth fullHeight overflowY="auto">
            <PaperPage width="wide">
                <PaperPageHeader icon="dns" title="Servers">
                    <PaperEffect variant="success">
                        <PaperButton
                            variant="success"
                            disabled={Boolean(props.state.serversError)}
                            onClick={() => ask("add")}
                        >
                            <PaperIcon>add</PaperIcon>New server
                        </PaperButton>
                    </PaperEffect>
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
                            <PaperButton
                                variant="primary"
                                disabled={Boolean(props.state.serversError)}
                                onClick={() => ask("add")}
                            >
                                New server
                            </PaperButton>
                        </PaperEmptyState>
                    }
                >
                    <PaperMediaCardGroup minCardWidth="card-min">
                        <For each={props.state.servers}>
                            {(server) => (
                                <PaperMediaCard
                                    effect={false}
                                    icon={server.icon ?? gameFor(server.game).icon}
                                    title={server.name}
                                    subtitle={`${gameFor(server.game).name} · ${gameFor(server.game).softwareLabel({ software: server.state.serverSoftware, version: server.state.serverVersion })}`}
                                    description={
                                        server.state.recoveryBlock ??
                                        (!server.configured ? "Finish setup" : undefined)
                                    }
                                    badge={
                                        <PaperBadge
                                            variant={
                                                server.state.recoveryBlock
                                                    ? "danger"
                                                    : server.state.serverStatus === "online"
                                                      ? "success"
                                                      : "monochrome"
                                            }
                                        >
                                            {server.state.recoveryBlock
                                                ? "Error"
                                                : server.state.serverStatus}
                                        </PaperBadge>
                                    }
                                    onClick={() => openServer(server.id)}
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
                <PaperContextMenuItem icon="open_in_new" onClick={() => openServer(target()!.id)}>
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
                open={dialog() !== null}
                onClose={() => {
                    if (!busy()) setDialog(null);
                }}
                title={
                    dialog() === "add"
                        ? "New server"
                        : dialog() === "rename"
                          ? "Rename server"
                          : `Remove ${target()?.name ?? "server"}?`
                }
                footer={
                    <PaperFlex gap="half">
                        <PaperButton
                            variant="text"
                            disabled={busy()}
                            onClick={() => setDialog(null)}
                        >
                            Cancel
                        </PaperButton>
                        <PaperButton
                            disabled={busy() || (dialog() !== "remove" && !name().trim())}
                            onClick={() => void submit()}
                        >
                            {busy()
                                ? "Saving…"
                                : dialog() === "add"
                                  ? "Continue to setup"
                                  : dialog() === "remove"
                                    ? "Remove server"
                                    : "Save name"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <Show when={error()}>
                    {(error) => (
                        <PaperQuote
                            variant="danger"
                            title="Server could not be changed"
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
                            The server will stop and leave this list and Actions. Its files and
                            backups will be kept.
                        </PaperText>
                    }
                >
                    <Show when={dialog() === "add"}><GamePicker games={games} value={game()} onPick={g => setGame(g.id)} /></Show>
                    <PaperInput
                        fullWidth
                        autofocus
                        label="Server name"
                        value={name()}
                        onInput={(e) => setName(e.currentTarget.value)}
                    />
                </Show>
            </PaperModal>
        </PaperFlex>
    );
}
