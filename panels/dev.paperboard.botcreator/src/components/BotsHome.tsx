// The first thing Bot Creator shows: every bot as a card, whether it is
// online and how many servers it is in, and a way to add another. Each bot
// runs on its own, with its own token, commands and Blocks project.
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
import { count, errorToMessage } from "../types";
import { pictureIcon } from "../picture";

/** "3 servers" for a bot online, or why it isn't, as its card says it. */
export function botStatusText(bot: BotSummary): string {
    if (bot.connected) return count(bot.guildCount, "server");
    if (!bot.hasToken) return "Needs a token";
    if (bot.connecting) return "Connecting…";
    return bot.enabled ? "Offline" : "Off";
}

export default function BotsHome(props: { bots: BotsState; onOpen: (bot: { id: string }) => void }) {
    const [failure, setFailure] = createSignal<{ title: string; text: string } | null>(null);
    const [adding, setAdding] = createSignal(false);
    // a switch flips once its bot is on or off, and its thump waits for that;
    // only the newest flip of a bot may say it failed
    const flips = new Map<string, number>();
    const setEnabled = async (bot: BotSummary, enabled: boolean) => {
        const flip = (flips.get(bot.id) ?? 0) + 1;
        flips.set(bot.id, flip);
        setFailure(null);
        try {
            await props.bots.setEnabled(bot.id, enabled);
        } catch (err) {
            if (flips.get(bot.id) === flip) setFailure({ title: enabled ? `${bot.name} didn't come online` : `${bot.name} didn't go offline`, text: errorToMessage(err) });
        }
    };

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
            <PaperButton variant="success" disabled={!props.bots.ready() || Boolean(props.bots.state().botsError)} onClick={() => setAdding(true)}>
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
                    <Show when={props.bots.list().length > 0}>{newBot()}</Show>
                </PaperPageHeader>
                <Show when={failure()}>
                    {(f) => (
                        <PaperQuote variant="danger" icon="warning" title={f().title} role="alert" onDismiss={() => setFailure(null)}>
                            {f().text}
                        </PaperQuote>
                    )}
                </Show>
                <Show when={props.bots.state().botsError}>
                    {(text) => (
                        <PaperQuote variant="danger" icon="warning" title="Bots could not be read" role="alert">{text()}</PaperQuote>
                    )}
                </Show>
                <Show
                    when={props.bots.ready()}
                    fallback={
                        <Show when={props.bots.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading bots" />}>
                            {(reason) => (
                                <PaperEmptyState icon="error" title="Bots could not be loaded" description={reason()} role="alert">
                                    <PaperButton onClick={() => void props.bots.load()}>Try again</PaperButton>
                                </PaperEmptyState>
                            )}
                        </Show>
                    }
                >
                    <Show
                        when={props.bots.list().length > 0}
                        fallback={
                            <PaperEmptyState icon="smart_toy" title="No bots yet" description="All a bot needs is a token from the Discord Developer Portal. Then decide what it does in Blocks.">
                                {newBot()}
                            </PaperEmptyState>
                        }
                    >
                        <PaperMediaCardGroup minCardWidth="card-min">
                            <For each={props.bots.list()}>
                                {(bot) => (
                                    <PaperMediaCard
                                        effect={false}
                                        icon={pictureIcon(bot.avatar, "smart_toy")}
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
                                                onChange={(enabled) => setEnabled(bot, enabled)}
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
            <NewBotModal open={adding()} onAdd={props.bots.add} onAdded={props.onOpen} onClose={() => setAdding(false)} />
            <ReplaceTokenModal bot={replacing()} onReplace={props.bots.replaceToken} onClose={() => setReplacing(null)} />
            <DeleteBotModal bot={deleting()} onDelete={props.bots.remove} onClose={() => setDeleting(null)} />
        </PaperFlex>
    );
}
