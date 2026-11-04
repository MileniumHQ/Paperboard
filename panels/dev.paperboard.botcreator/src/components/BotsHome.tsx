// The first thing Bot Creator shows: every bot as a card, whether it is
// online and how many servers it is in, and a way to add another. Each bot
// runs on its own, with its own token, commands and Actions project.
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
    PaperLoader,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperPage,
    PaperPageHeader,
    PaperQuote,
    PaperSeparator,
    PaperToggle,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { DeleteBotModal, NewBotModal, ReplaceTokenModal } from "./BotDialogs";
import type { BotsState } from "../state";
import type { BotSummary } from "../bots";
import { DEFAULT_DISCORD_AVATAR, errorToMessage } from "../types";

/** "3 servers" for a bot online, or why it isn't, as its card says it. */
export function botStatusText(bot: BotSummary): string {
    if (bot.connected) return `${bot.guildCount} ${bot.guildCount === 1 ? "server" : "servers"}`;
    if (!bot.hasToken) return "Needs a token";
    if (bot.connecting) return "Connecting…";
    return bot.enabled ? "Offline" : "Off";
}

export default function BotsHome(props: { bots: BotsState; onOpen: (bot: { id: string }) => void }) {
    const bots = props.bots;
    const [failure, setFailure] = createSignal<{ title: string; text: string } | null>(null);
    const [adding, setAdding] = createSignal(false);
    // a switch flips on its own, never waiting on another change
    const setEnabled = (bot: BotSummary, enabled: boolean) =>
        bots.setEnabled(bot.id, enabled).catch((err) =>
            setFailure({ title: enabled ? `${bot.name} didn't come online` : `${bot.name} didn't go offline`, text: errorToMessage(err) }));

    const menu = useContextMenuState("below-right");
    const [menuFor, setMenuFor] = createSignal<BotSummary | null>(null);
    const [replacing, setReplacing] = createSignal<BotSummary | null>(null);
    const [deleting, setDeleting] = createSignal<BotSummary | null>(null);
    const fromMenu = (act: (bot: BotSummary) => void) => () => {
        const bot = menuFor();
        menu.close();
        if (bot) act(bot);
    };

    const newBot = () => (
        <PaperEffect variant="success">
            <PaperButton variant="success" disabled={!bots.ready() || Boolean(bots.state().botsError)} onClick={() => setAdding(true)}>
                <PaperIcon>add</PaperIcon>
                New bot
            </PaperButton>
        </PaperEffect>
    );

    return (
        <PaperFlex fullWidth fullHeight overflowY="auto">
            <PaperPage width="wide">
                <PaperPageHeader icon="smart_toy" title="Bots">
                    {/* an empty page offers this in its empty state instead */}
                    <Show when={bots.list().length > 0}>{newBot()}</Show>
                </PaperPageHeader>
                <Show when={failure()}>
                    {(f) => (
                        <PaperQuote variant="danger" icon="warning" title={f().title} role="alert" onDismiss={() => setFailure(null)}>
                            {f().text}
                        </PaperQuote>
                    )}
                </Show>
                <Show when={bots.state().botsError}>
                    {(text) => (
                        <PaperQuote variant="danger" icon="warning" title="Bots could not be read" role="alert">{text()}</PaperQuote>
                    )}
                </Show>
                <Show
                    when={bots.ready()}
                    fallback={
                        <Show when={bots.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading bots" />}>
                            {(reason) => (
                                <PaperEmptyState icon="error" title="Bots could not be loaded" description={reason()} role="alert">
                                    <PaperButton onClick={() => void bots.load()}>Try again</PaperButton>
                                </PaperEmptyState>
                            )}
                        </Show>
                    }
                >
                    <Show
                        when={bots.list().length > 0}
                        fallback={
                            <PaperEmptyState icon="smart_toy" title="No bots yet" description="All a bot needs is a token from the Discord Developer Portal. Then decide what it does in Actions.">
                                {newBot()}
                            </PaperEmptyState>
                        }
                    >
                        <PaperMediaCardGroup minCardWidth="card-min">
                            <For each={bots.list()}>
                                {(bot) => (
                                    <PaperMediaCard
                                        effect={false}
                                        icon={bot.avatar || DEFAULT_DISCORD_AVATAR}
                                        title={bot.name}
                                        subtitle={botStatusText(bot)}
                                        description={bot.connected ? undefined : bot.lastError ?? undefined}
                                        badge={
                                            bot.connected
                                                ? <PaperBadge variant="success">Online</PaperBadge>
                                                : bot.enabled && bot.lastError ? <PaperBadge variant="danger">Error</PaperBadge> : undefined
                                        }
                                        onClick={() => props.onOpen(bot)}
                                        footerLeft={
                                            <PaperToggle
                                                checked={bot.enabled}
                                                disabled={!bot.hasToken}
                                                aria-label={`${bot.name} is on`}
                                                title={bot.enabled ? "On: runs while Paperboard does" : "Off"}
                                                onChange={(enabled) => void setEnabled(bot, enabled)}
                                            />
                                        }
                                        footerRight={
                                            <PaperButton
                                                icon
                                                variant="text"
                                                title="More"
                                                aria-label={`More for ${bot.name}`}
                                                onClick={(e) => {
                                                    setMenuFor(bot);
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
                </Show>
            </PaperPage>
            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <PaperContextMenuItem icon="open_in_new" onClick={fromMenu(props.onOpen)}>Open</PaperContextMenuItem>
                <PaperContextMenuItem icon="key" onClick={fromMenu(setReplacing)}>Replace token</PaperContextMenuItem>
                <PaperSeparator role="separator" />
                <PaperContextMenuItem icon="delete" danger onClick={fromMenu(setDeleting)}>Delete</PaperContextMenuItem>
            </PaperContextMenu>
            <NewBotModal open={adding()} onAdd={bots.add} onAdded={props.onOpen} onClose={() => setAdding(false)} />
            <ReplaceTokenModal bot={replacing()} onReplace={bots.replaceToken} onClose={() => setReplacing(null)} />
            <DeleteBotModal bot={deleting()} onDelete={bots.remove} onClose={() => setDeleting(null)} />
        </PaperFlex>
    );
}
