import { createSignal, onMount, Show } from "solid-js";
import {
    PaperPanel,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";

const PANEL_ID = "dev.paperboard.botcreator";
import Setup from "./components/Setup";
import Overview from "./components/Overview";
import Commands from "./components/Commands";
import Servers from "./components/Servers";
import Invite from "./components/Invite";
import Configuration from "./components/Configuration";
import "@paperboard-dev/paperui/style.css";
import "@paperboard-dev/paperui/panel.css";

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");

    const checkConfig = async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved && typeof saved === "object") {
                setConfigured(Boolean(saved.configured));
            } else {
                setConfigured(false);
            }
        } catch (err) {
            console.debug("[botcreator] saved config unreadable, treating as unconfigured:", String(err));
            setConfigured(false);
        }
    };

    onMount(() => {
        checkConfig();
    });

    return (
        <Show when={configured() !== null}>
            <Show
                when={configured()}
                fallback={<Setup onComplete={() => setConfigured(true)} />}
            >
                <PaperPanel>
                    <PaperMenu
                        name="botMenu"
                        spacing="half"
                        value={activeTab()}
                        onValueChange={(val) => setActiveTab(String(val))}
                    >
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
                            <Overview />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="commands">
                            <Commands />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="servers">
                            <Servers />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="invite">
                            <Invite />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="config">
                            <Configuration onReset={() => setConfigured(false)} />
                        </PaperInterfaceItem>
                    </PaperInterfaceGroup>
                </PaperPanel>
            </Show>
        </Show>
    );
}
