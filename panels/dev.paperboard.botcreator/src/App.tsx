// Bot Creator opens on its bots, like Blocks on its projects; opening one
// shows its pages. A bot deleted while it is open returns here. On a phone
// the bot's pages are another menu: they slide in over the list, and back
// (the button, the swipe) returns to it.
import { createEffect, createSignal, on, Show } from "solid-js";
import {
    PaperFlex,
    PaperPanel,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperQuote,
    PaperSlidePage,
    createPaperCompact,
} from "@mileniumhq/paperui";
import BotsHome from "./components/BotsHome";
import Overview from "./components/Overview";
import Commands from "./components/Commands";
import Servers from "./components/Servers";
import Invite from "./components/Invite";
import Configuration from "./components/Configuration";
import SetupGuide from "./components/SetupGuide";
import { createBots, type BotsState } from "./state";
import { DiscordAvatar } from "./picture";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { errorMessage } from "@mileniumhq/paperapi";

// the menu entry that leaves the bot for the home screen
const HOME_ENTRY = "home";

function BotView(props: { id: string; bots: BotsState; compact: boolean; onHome: () => void }) {
    const [activeTab, setActiveTab] = createSignal("overview");
    // the bot as the service last announced it; the view closes before it is gone
    const bot = () => props.bots.find(props.id)!;

    return (
        <PaperPanel>
            <PaperMenu
                name="botMenu"
                value={activeTab()}
                onValueChange={(val) => {
                    if (val === HOME_ENTRY) props.onHome();
                    else setActiveTab(String(val));
                }}
            >
                {/* on a phone the page's own bar goes back, and says whose bot this is */}
                <Show when={!props.compact}>
                    <PaperMenuItem value={HOME_ENTRY} icon="arrow_back">
                        All bots
                    </PaperMenuItem>
                    <PaperMenuLabel>{bot().name}</PaperMenuLabel>
                </Show>
                <PaperMenuItem value="overview" icon="dashboard">
                    Overview
                </PaperMenuItem>
                <PaperMenuItem value="commands" icon="terminal">
                    Commands
                </PaperMenuItem>
                <PaperMenuItem value="servers" icon="dns">
                    Servers
                </PaperMenuItem>
                <PaperMenuItem value="invite" icon="person_add">
                    Invite
                </PaperMenuItem>
                <PaperMenuItem value="config" icon="settings">
                    Configuration
                </PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={activeTab()}>
                <PaperInterfaceItem value="overview">
                    <Overview bot={bot} onSetEnabled={(enabled) => props.bots.setEnabled(props.id, enabled)} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="commands">
                    <Commands bot={bot} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="servers">
                    <Servers bot={bot} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="invite">
                    <Invite bot={bot} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="config">
                    <Configuration bot={bot} onReplaceToken={props.bots.replaceToken} onDelete={props.bots.remove} />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}

export default function App() {
    const bots = createBots();
    const compact = createPaperCompact();
    const [opened, setOpened] = createSignal<string | null>(null);
    // a failed save of "the guide was skipped", shown where the guide was
    const [skipError, setSkipError] = createSignal<string | null>(null);
    // whether the open bot has been in the list, so that leaving it means
    // it was deleted rather than not announced yet: a bot just added is
    // opened before the service's list, a moment later, shows it
    let listed = false;
    const open = (id: string) => {
        listed = false;
        setOpened(id);
    };

    createEffect(on(() => {
        const id = opened();
        return id ? Boolean(bots.find(id)) : null;
    }, (known) => {
        if (known) listed = true;
        else if (known === false && listed) setOpened(null);
    }));

    // the bot being shown: opened, and known to the service
    const shown = () => {
        const id = opened();
        return bots.ready() && id && bots.find(id) ? id : null;
    };
    // On a phone the page stays mounted while it slides away, so it needs a
    // bot to show until it has gone: the last one shown, for as long as it
    // exists. On a computer the page is only there while it is open.
    const [lastShown, setLastShown] = createSignal<string | null>(null);
    createEffect(on(shown, (id) => {
        if (id) setLastShown(id);
    }));
    const pageBot = () => {
        const id = compact() ? lastShown() : shown();
        return id && bots.find(id) ? id : null;
    };
    const listShown = () => compact() || !shown();

    // no bots, and the guide not yet finished or skipped
    const guideShown = () => bots.ready() && !bots.state().botsError && !bots.state().setupGuideSeen && bots.list().length === 0 && !opened();
    const skipGuide = () => {
        setSkipError(null);
        bots.markSetupGuideSeen().catch((err) => setSkipError(errorMessage(err)));
    };

    return (
        <PaperFlex fullWidth fullHeight overflow="hidden">
            <Show when={guideShown()} fallback={<Show when={listShown()}><BotsHome bots={bots} onOpen={(bot) => open(bot.id)} /></Show>}>
                <PaperFlex direction="column" fullWidth fullHeight>
                    <Show when={skipError()}>
                        {(text) => (
                            <PaperFlex padding="half" fullWidth>
                                <PaperQuote variant="danger" icon="warning" title="The guide could not be skipped" role="alert" onDismiss={() => setSkipError(null)}>{text()}</PaperQuote>
                            </PaperFlex>
                        )}
                    </Show>
                    <SetupGuide onAdd={bots.add} onAdded={(bot) => open(bot.id)} onSkip={skipGuide} />
                </PaperFlex>
            </Show>
            <PaperSlidePage
                enabled={compact()}
                open={shown() !== null}
                title={(pageBot() && bots.find(pageBot()!)?.name) || ""}
                icon={<DiscordAvatar size="small" url={pageBot() && bots.find(pageBot()!)?.avatar} fallbackIcon="smart_toy" />}
                onBack={() => setOpened(null)}
            >
                <Show when={pageBot()} keyed>
                    {(id) => <BotView id={id} bots={bots} compact={compact()} onHome={() => setOpened(null)} />}
                </Show>
            </PaperSlidePage>
        </PaperFlex>
    );
}
