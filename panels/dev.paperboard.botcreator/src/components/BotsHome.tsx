// The first thing Bot Creator shows: every bot as a card, whether it is
// online and how many servers it is in, and a way to add another. Each bot
// runs on its own, with its own token, commands and Blocks project.
import { createSignal, For, Match, Show, Switch } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperEmptyState,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperLoader,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperPage,
    PaperPageHeader,
    PaperSeparator,
    PaperToggle,
    createAction,
    dismissToast,
    showError,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { DeleteBotModal, NewBotModal, ReplaceTokenModal } from "./BotDialogs";
import type { BotsState } from "../state";
import type { BotSummary } from "../bots";
import { count } from "../types";
import { pictureIcon } from "../picture";

/** "3 servers" for a bot online, or why it isn't, as its card says it. */
function botStatusText(bot: BotSummary): string {
    if (bot.connected) return count(bot.guildCount, "server");
    if (!bot.hasToken) return "Needs a token";
    if (bot.connecting) return "Connecting…";
    return bot.enabled ? "Offline" : "Off";
}

export default function BotsHome(props: { bots: BotsState; onOpen: (bot: { id: string }) => void }) {
    const [adding, setAdding] = createSignal(false);
    // the service reading its saved bots again: the list's failure says why it still can't
    const reading = createAction({ toast: false });
    // a switch flips once saved; its thump waits for the bot to be on or off.
    // Only the newest flip of a bot may say it failed, and the next flip
    // takes back what the last one said
    const flips = new Map<string, { flip: number; toast?: string }>();
    const setEnabled = async (bot: BotSummary, enabled: boolean) => {
        const before = flips.get(bot.id);
        if (before?.toast) dismissToast(before.toast);
        const mine = { flip: (before?.flip ?? 0) + 1 } as { flip: number; toast?: string };
        flips.set(bot.id, mine);
        try {
            await props.bots.setEnabled(bot.id, enabled);
        } catch (err) {
            if (flips.get(bot.id) === mine) mine.toast = showError(enabled ? `${bot.name} didn't come online` : `${bot.name} didn't go offline`, err);
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
                    {newBot()}
                </PaperPageHeader>
                <Show
                    when={props.bots.ready() && !props.bots.state().botsError}
                    fallback={
                        <Switch fallback={<PaperLoader loaderStatus="indeterminate" label="Loading bots" />}>
                            {/* this window couldn't ask the service */}
                            <Match when={props.bots.loadError()}>
                                {(why) => (
                                    <PaperError fill title="Couldn't load the bots" error={why()} action={{ label: "Try again", onClick: () => void props.bots.load() }} />
                                )}
                            </Match>
                            {/* the service couldn't read its saved bots */}
                            <Match when={props.bots.state().botsError}>
                                {(why) => (
                                    <PaperError
                                        fill
                                        title="Couldn't read the saved bots"
                                        error={reading.error()?.message ?? why()}
                                        action={{ label: "Try again", disabled: reading.busy(), onClick: () => void reading.run("Couldn't read the saved bots", props.bots.readAgain) }}
                                    />
                                )}
                            </Match>
                        </Switch>
                    }
                >
                    <Show
                        when={props.bots.list().length > 0}
                        fallback={
                            <PaperEmptyState icon="smart_toy" title="No bots yet" description="All a bot needs is a token from the Discord Developer Portal. Then decide what it does in Blocks." />
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
