// The panel once the agent exists: the conversation, and one menu that opens a
// modal with a sidebar (computer, apps, memories, routines, tools, settings)
// beside the page. An app opened from a card or the Apps page slides in from
// the right, and the chat steps aside to a column, or all the way off to the left.

import { For, Match, Show, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperFlex, PaperMenu, PaperMenuItem, PaperModal } from "@mileniumhq/paperui";
import Apps from "./apps/Apps";
import AppView from "./apps/AppView";
import { createLauncher, type OpenApp } from "./apps/launcher";
import Chat from "./chat/Chat";
import ComputerView from "./computer/ComputerView";
import { createFace } from "./face/controller";
import Memories from "./memories/Memories";
import Routines from "./routines/Routines";
import Settings from "./settings/Settings";
import Tools from "./tools/Tools";
import type { Agent } from "./lib/agent";
import styles from "./Workspace.module.css";

export type Page = "computer" | "apps" | "memories" | "routines" | "tools" | "settings";

const PAGES: { id: Page; title: string; icon: string }[] = [
    { id: "computer", title: "Computer", icon: "computer" },
    { id: "apps", title: "Apps", icon: "apps" },
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

    const apps = createLauncher(agent);
    // the chat gone off to the left, the app the whole width; a phone only ever shows one
    const [extended, setExtended] = createSignal(false);
    // the app stays drawn while it slides away, and goes once it's off screen
    const [drawn, setDrawn] = createSignal<OpenApp | null>(null);
    let appPane!: HTMLDivElement;
    createEffect(() => {
        const s = apps.shown();
        if (s) return void setDrawn(s);
        setExtended(false);
        // the slide away, if there is one (none when motion is reduced); a slide cut short ends it too
        void Promise.allSettled(appPane.getAnimations().map((a) => a.finished)).then(() => !apps.shown() && setDrawn(null));
    });

    return (
        <>
            <div class={styles.split} classList={{ [styles.open!]: !!apps.shown(), [styles.extended!]: !!apps.shown() && (extended() || phone()) }}>
                <div class={styles.chatPane} inert={!!apps.shown() && (extended() || phone())}>
                    <div class={styles.chat}>
                        <Chat agent={agent} face={face} apps={apps} onMenu={() => setOpen(true)} />
                    </div>
                </div>
                <div class={styles.appPane} ref={appPane} inert={!apps.shown()}>
                    <Show when={drawn()}>
                        {(app) => <AppView app={app()} extended={extended()} phone={phone()} onExtend={() => setExtended((x) => !x)} onClose={apps.close} />}
                    </Show>
                </div>
            </div>
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
                            <Match when={page() === "apps"}>
                                <Apps apps={apps} name={agent.state.settings?.name ?? "your agent"} onOpened={() => setOpen(false)} />
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
