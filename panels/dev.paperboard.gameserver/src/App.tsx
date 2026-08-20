import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "paperui";
import { config } from "paperapi";
import Setup from "./Setup";
import Overview from "./Overview";
import Chat from "./Chat";
import "paperui/style.css";
import "./style.css";

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");

    const checkConfig = async () => {
        try {
            const saved = await config.get<any>();
            if (saved && typeof saved === "object") {
                setConfigured(Boolean(saved.configured));
            } else {
                setConfigured(false);
            }
        } catch {
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
                <PaperFlex direction="row" fullWidth fullHeight>
                    <PaperMenu
                        name="serverMenu"
                        spacing="half"
                        value={activeTab()}
                        onValueChange={(val) => setActiveTab(String(val))}
                    >
                        <PaperMenuItem value="overview" icon="dashboard">
                            Overview
                        </PaperMenuItem>
                        <PaperMenuItem value="options" icon="tune">
                            Options
                        </PaperMenuItem>
                        <PaperMenuItem value="chat" icon="chat">
                            Chat
                        </PaperMenuItem>
                        <PaperMenuItem value="gamerules" icon="list_alt_check">
                            Game Rules
                        </PaperMenuItem>
                        <PaperMenuItem value="players" icon="group">
                            Players
                        </PaperMenuItem>
                        <PaperMenuItem value="plugins" icon="extension">
                            Plugins/Mods
                        </PaperMenuItem>
                        <PaperMenuItem value="version" icon="deployed_code">
                            Version
                        </PaperMenuItem>
                        <PaperMenuItem value="world" icon="public">
                            World
                        </PaperMenuItem>
                        <PaperMenuItem value="backups" icon="backup">
                            Backups
                        </PaperMenuItem>
                    </PaperMenu>

                    <PaperInterfaceGroup
                        value={activeTab()}
                        style={{ flex: 1, height: "100%" }}
                    >
                        <PaperInterfaceItem value="overview">
                            <Overview />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="chat">
                            <Chat />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="options" />
                        <PaperInterfaceItem value="gamerules" />
                        <PaperInterfaceItem value="players" />
                        <PaperInterfaceItem value="plugins" />
                        <PaperInterfaceItem value="version" />
                        <PaperInterfaceItem value="world" />
                        <PaperInterfaceItem value="backups" />
                    </PaperInterfaceGroup>
                </PaperFlex>
            </Show>
        </Show>
    );
}
