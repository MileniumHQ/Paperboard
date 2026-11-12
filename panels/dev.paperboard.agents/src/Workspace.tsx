// The panel once the agent exists: the conversation, and one menu that opens a
// modal with a sidebar (computer, apps, memories, routines, tools, access, settings)
// beside the page. An app opened from a card or the Apps page slides in from
// the right, and the chat steps aside to a column, or all the way off to the left.

import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperFlex, PaperMenu, PaperMenuItem, PaperModal } from "@mileniumhq/paperui";
import Access from "./access/Access";
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
import { PageHold } from "./lib/pageHold";
import styles from "./Workspace.module.css";

export type Page = "computer" | "apps" | "memories" | "routines" | "tools" | "access" | "settings";

const PAGES: { id: Page; title: string; icon: string }[] = [
    { id: "computer", title: "Computer", icon: "computer" },
    { id: "apps", title: "Apps", icon: "apps" },
    { id: "memories", title: "Memories", icon: "neurology" },
    { id: "routines", title: "Routines", icon: "event_repeat" },
    { id: "tools", title: "Tools", icon: "construction" },
    { id: "access", title: "Access", icon: "shield_person" },
    { id: "settings", title: "Settings", icon: "settings" },
];

// how long a chosen page may wait for its first read before it shows with its loader
const HOLD_MS = 300;

export default function Workspace(props: { agent: Agent }) {
    const { agent } = props;
    const [open, setOpen] = createSignal(false);
    // the last page stays chosen while the panel is open; only the open page is mounted,
    // and a newly chosen one beside it, out of sight, until its first read is in
    const [page, setPage] = createSignal<Page>("computer");
    const [shown, setShown] = createSignal<Page>("computer");
    const mounted = () => (page() === shown() ? [shown()] : [shown(), page()]);
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);

    const title = () => PAGES.find((p) => p.id === shown())!.title;

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

    const view = (p: Page) => {
        switch (p) {
            case "computer":
                return <ComputerView agent={agent} />;
            case "apps":
                return <Apps apps={apps} name={agent.state.settings?.name ?? "your agent"} onOpened={() => setOpen(false)} />;
            case "memories":
                return <Memories agent={agent} />;
            case "routines":
                return <Routines agent={agent} />;
            case "tools":
                return <Tools agent={agent} />;
            case "access":
                return <Access agent={agent} />;
            case "settings":
                return <Settings agent={agent} />;
        }
    };

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
                    <PaperFlex flex minWidth={0} minHeight={0} scrollable="y" padding={shown() === "computer" || shown() === "apps" || shown() === "tools" || shown() === "access" ? undefined : "double"}>
                        <For each={mounted()}>
                            {(p) => {
                                // a chosen page asks for its first reads as it mounts; one that reads nothing shows in this same frame
                                const held: Promise<unknown>[] = [];
                                if (p !== untrack(shown)) {
                                    queueMicrotask(() => {
                                        const waited = held.length ? Promise.race([Promise.allSettled(held), new Promise((r) => setTimeout(r, HOLD_MS))]) : Promise.resolve();
                                        void waited.then(() => page() === p && setShown(p));
                                    });
                                }
                                return (
                                    <PageHold.Provider value={(read) => held.push(read)}>
                                        <PaperFlex flex minWidth={0} hidden={p !== shown()}>
                                            {view(p)}
                                        </PaperFlex>
                                    </PageHold.Provider>
                                );
                            }}
                        </For>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
