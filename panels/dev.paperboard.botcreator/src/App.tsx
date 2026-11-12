// Bot Creator opens on its bots, like Blocks on its projects; opening one
// shows its pages. A bot deleted while it is open returns here.
import { createEffect, createSignal, Show } from "solid-js";
import {
    PaperPanel,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import BotsHome from "./components/BotsHome";
import Overview from "./components/Overview";
import Commands from "./components/Commands";
import Servers from "./components/Servers";
import Invite from "./components/Invite";
import Configuration from "./components/Configuration";
import { createBots, type BotsState } from "./state";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

// the menu entry that leaves the bot for the home screen
const HOME_ENTRY = "home";

function BotView(props: { id: string; bots: BotsState; onHome: () => void }) {
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
                <PaperMenuItem value={HOME_ENTRY} icon="arrow_back">
                    All bots
                </PaperMenuItem>
                <PaperMenuLabel>{bot().name}</PaperMenuLabel>
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
    const [opened, setOpened] = createSignal<string | null>(null);
    // whether the open bot has been in the list, so that leaving it means
    // it was deleted rather than not announced yet: a bot just added is
    // opened before the service's list, a moment later, shows it
    let listed = false;
    const open = (id: string) => {
        listed = false;
        setOpened(id);
    };

    createEffect(() => {
        const id = opened();
        if (!id) return;
        if (bots.find(id)) listed = true;
        else if (listed) setOpened(null);
    });

    return (
        <Show
            when={bots.ready() && opened() && bots.find(opened()!) ? opened() : null}
            keyed
            fallback={<BotsHome bots={bots} onOpen={(bot) => open(bot.id)} />}
        >
            {(id) => <BotView id={id} bots={bots} onHome={() => setOpened(null)} />}
        </Show>
    );
}
