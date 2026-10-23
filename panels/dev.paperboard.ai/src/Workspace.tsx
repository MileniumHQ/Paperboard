// The panel once the agent exists: the conversation, with its computer,
// memories and settings in modals over it (opened from the composer's menus).

import { Show, createSignal, onCleanup } from "solid-js";
import { PaperModal } from "@mileniumhq/paperui";
import Chat from "./chat/Chat";
import ComputerView from "./computer/ComputerView";
import { createFace } from "./face/controller";
import Memories from "./memories/Memories";
import Settings from "./settings/Settings";
import type { Agent } from "./lib/agent";

export type Sheet = "computer" | "memories" | "settings";

const TITLES: Record<Sheet, string> = { computer: "Computer", memories: "Memories", settings: "Settings" };

export default function Workspace(props: { agent: Agent }) {
    const { agent } = props;
    const [sheet, setSheet] = createSignal<Sheet | null>(null);
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);
    const close = () => setSheet(null);

    return (
        <>
            <Chat agent={agent} face={face} onOpen={setSheet} />
            {/* one modal at a time; closing it unmounts its content, which hands back the computer */}
            <PaperModal open={sheet() !== null} onClose={close} title={sheet() ? TITLES[sheet()!] : ""} size={sheet() === "computer" ? "full" : "medium"}>
                <Show when={sheet() === "computer"}>
                    <ComputerView agent={agent} />
                </Show>
                <Show when={sheet() === "memories"}>
                    <Memories agent={agent} />
                </Show>
                <Show when={sheet() === "settings"}>
                    <Settings agent={agent} />
                </Show>
            </PaperModal>
        </>
    );
}
