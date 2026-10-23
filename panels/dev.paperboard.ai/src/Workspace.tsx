// The panel once the agent exists: the conversation, and one menu that opens a
// modal with a sidebar (computer, memories, tools, settings) beside the page.

import { For, Match, Switch, createSignal, onCleanup } from "solid-js";
import { PaperMenu, PaperMenuItem, PaperModal } from "@mileniumhq/paperui";
import Chat from "./chat/Chat";
import ComputerView from "./computer/ComputerView";
import { createFace } from "./face/controller";
import Memories from "./memories/Memories";
import Settings from "./settings/Settings";
import Tools from "./tools/Tools";
import type { Agent } from "./lib/agent";
import styles from "./Workspace.module.css";

export type Page = "computer" | "memories" | "tools" | "settings";

const PAGES: { id: Page; title: string; icon: string }[] = [
    { id: "computer", title: "Computer", icon: "computer" },
    { id: "memories", title: "Memories", icon: "neurology" },
    { id: "tools", title: "Tools", icon: "construction" },
    { id: "settings", title: "Settings", icon: "settings" },
];

export default function Workspace(props: { agent: Agent }) {
    const { agent } = props;
    const [open, setOpen] = createSignal(false);
    // the last page stays chosen while the panel is open; only the open page is mounted
    const [page, setPage] = createSignal<Page>("computer");
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);

    const title = () => PAGES.find((p) => p.id === page())!.title;

    return (
        <>
            <Chat agent={agent} face={face} onMenu={() => setOpen(true)} />
            {/* closing the modal unmounts the page, which hands back the computer */}
            <PaperModal open={open()} onClose={() => setOpen(false)} title={title()} size="full" noPadding>
                <div class={styles.layout}>
                    <PaperMenu class={styles.sidebar} name="ai-pages" aria-label="Menu" value={page()} onValueChange={(v) => setPage(v as Page)}>
                        <For each={PAGES}>
                            {(p) => (
                                <PaperMenuItem value={p.id} icon={p.icon}>
                                    {p.title}
                                </PaperMenuItem>
                            )}
                        </For>
                    </PaperMenu>
                    <div class={styles.page} classList={{ [styles.padded!]: page() !== "computer" }}>
                        <Switch>
                            <Match when={page() === "computer"}>
                                <ComputerView agent={agent} />
                            </Match>
                            <Match when={page() === "memories"}>
                                <Memories agent={agent} />
                            </Match>
                            <Match when={page() === "tools"}>
                                <Tools agent={agent} />
                            </Match>
                            <Match when={page() === "settings"}>
                                <Settings agent={agent} />
                            </Match>
                        </Switch>
                    </div>
                </div>
            </PaperModal>
        </>
    );
}
