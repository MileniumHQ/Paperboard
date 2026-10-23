// The panel once the agent exists, laid out like every other panel: a
// sidebar (the conversation, the computer, memories, settings) beside the
// page it opens. Below the phone breakpoint PaperPanel turns the sidebar into
// a list whose entries slide in as pages.

import { createSignal, onCleanup } from "solid-js";
import { PaperInterfaceGroup, PaperInterfaceItem, PaperMenu, PaperMenuItem, PaperPanel } from "@mileniumhq/paperui";
import Chat from "./chat/Chat";
import ComputerPage from "./computer/ComputerPage";
import { createFace } from "./face/controller";
import Memories from "./memories/Memories";
import Settings from "./settings/Settings";
import type { Agent } from "./lib/agent";

type Page = "chat" | "computer" | "memories" | "settings";

export default function Workspace(props: { agent: Agent }) {
    const { agent } = props;
    const [page, setPage] = createSignal<Page>("chat");
    // the conversation's face outlives its page, so it doesn't start over each time it's opened
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);

    return (
        <PaperPanel>
            <PaperMenu name="ai-menu" spacing="half" value={page()} onValueChange={(v) => setPage(v as Page)}>
                <PaperMenuItem value="chat" icon="chat_bubble">
                    {agent.state.settings?.name ?? "Chat"}
                </PaperMenuItem>
                <PaperMenuItem value="computer" icon="computer">
                    Computer
                </PaperMenuItem>
                <PaperMenuItem value="memories" icon="neurology">
                    Memories
                </PaperMenuItem>
                <PaperMenuItem value="settings" icon="settings">
                    Settings
                </PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={page()}>
                <PaperInterfaceItem value="chat" variant="full">
                    <Chat agent={agent} face={face} onOpenSettings={() => setPage("settings")} onShowComputer={() => setPage("computer")} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="computer" variant="full">
                    <ComputerPage agent={agent} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="memories">
                    <Memories agent={agent} />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="settings">
                    <Settings agent={agent} />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}
