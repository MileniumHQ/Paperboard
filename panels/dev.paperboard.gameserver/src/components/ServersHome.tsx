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
import { gameFor, games } from "../games";
import GamePicker from "./GamePicker";
export default function ServersHome(props: { state: ServersState }) {
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
                                    icon={server.icon ?? gameFor(server.game).art.icon}
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
                    <PaperInput
                        fullWidth
                        autofocus
                        label="Server name"
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
