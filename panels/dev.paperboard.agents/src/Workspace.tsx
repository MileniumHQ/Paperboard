// The panel once the agent exists: the conversation, and one menu that opens a
// modal with a sidebar (computer, memories, routines, tools, settings) beside the page.

import { For, Match, Switch, createSignal, onCleanup } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperFlex, PaperMenu, PaperMenuItem, PaperModal } from "@mileniumhq/paperui";
import Chat from "./chat/Chat";
import ComputerView from "./computer/ComputerView";
import { createFace } from "./face/controller";
import Memories from "./memories/Memories";
import Routines from "./routines/Routines";
import Settings from "./settings/Settings";
import Tools from "./tools/Tools";
import type { Agent } from "./lib/agent";
import styles from "./Workspace.module.css";

export type Page = "computer" | "memories" | "routines" | "tools" | "settings";

const PAGES: { id: Page; title: string; icon: string }[] = [
    { id: "computer", title: "Computer", icon: "computer" },
    { id: "memories", title: "Memories", icon: "neurology" },
    { id: "routines", title: "Routines", icon: "event_repeat" },
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

    // phones: the menu becomes a strip above the page, at the width panels take their phone layout
    const narrow = matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [phone, setPhone] = createSignal(narrow.matches);
    const onWidth = () => setPhone(narrow.matches);
    narrow.addEventListener("change", onWidth);
    onCleanup(() => narrow.removeEventListener("change", onWidth));

    return (
        <>
            <Chat agent={agent} face={face} onMenu={() => setOpen(true)} />
            {/* closing the modal unmounts the page, which hands back the computer */}
            <PaperModal open={open()} onClose={() => setOpen(false)} title={title()} size="full" noPadding>
                <PaperFlex class={styles.layout} direction={phone() ? "column" : "row"} minHeight={0}>
                    <PaperMenu name="ai-pages" aria-label="Menu" horizontal={phone()} value={page()} onValueChange={(v) => setPage(v as Page)}>
                        <For each={PAGES}>
                            {(p) => (
                                <PaperMenuItem value={p.id} icon={p.icon}>
                                    {p.title}
                                </PaperMenuItem>
                            )}
                        </For>
                    </PaperMenu>
                    <PaperFlex flex minWidth={0} minHeight={0} scrollable="y" padding={page() === "computer" ? undefined : "double"}>
                        <Switch>
                            <Match when={page() === "computer"}>
                                <ComputerView agent={agent} />
                            </Match>
                            <Match when={page() === "memories"}>
                                <Memories agent={agent} />
                            </Match>
                            <Match when={page() === "routines"}>
                                <Routines agent={agent} />
                            </Match>
                            <Match when={page() === "tools"}>
                                <Tools agent={agent} />
                            </Match>
                            <Match when={page() === "settings"}>
                                <Settings agent={agent} />
                            </Match>
                        </Switch>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
