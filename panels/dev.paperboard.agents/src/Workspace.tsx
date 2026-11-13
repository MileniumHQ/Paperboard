// The panel once the agent exists: the conversation, and one menu that opens a
// modal with a sidebar (computer, pages, memories, routines, tools, access, settings)
// beside the page. A page opened from a card or the Pages page slides in from
// the right, and the chat steps aside to a column, or all the way off to the left.

import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperFlex, PaperMenu, PaperMenuItem, PaperModal } from "@mileniumhq/paperui";
import Access from "./access/Access";
import Pages from "./pages/Pages";
import PageView from "./pages/PageView";
import { createLauncher, type OpenPage } from "./pages/launcher";
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

export type Section = "computer" | "pages" | "memories" | "routines" | "tools" | "access" | "settings";

const SECTIONS: { id: Section; title: string; icon: string }[] = [
    { id: "computer", title: "Computer", icon: "computer" },
    { id: "pages", title: "Pages", icon: "web" },
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
    const [page, setPage] = createSignal<Section>("computer");
    const [shown, setShown] = createSignal<Section>("computer");
    const mounted = () => (page() === shown() ? [shown()] : [shown(), page()]);
    const face = createFace({ expression: "happy" });
    onCleanup(face.dispose);

    const title = () => SECTIONS.find((p) => p.id === shown())!.title;

    // phones: the menu becomes a strip above the page, at the width panels take their phone layout
    const narrow = matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [phone, setPhone] = createSignal(narrow.matches);
    const onWidth = () => setPhone(narrow.matches);
    narrow.addEventListener("change", onWidth);
    onCleanup(() => narrow.removeEventListener("change", onWidth));

    const pages = createLauncher(agent);
    // the chat gone off to the left, the page the whole width; a phone only ever shows one
    const [extended, setExtended] = createSignal(false);
    // the page stays drawn while it slides away, and goes once it's off screen
    const [drawn, setDrawn] = createSignal<OpenPage | null>(null);
    let pagePane!: HTMLDivElement;
    createEffect(() => {
        const s = pages.shown();
        if (s) return void setDrawn(s);
        setExtended(false);
        // the slide away, if there is one (none when motion is reduced); a slide cut short ends it too
        void Promise.allSettled(pagePane.getAnimations().map((a) => a.finished)).then(() => !pages.shown() && setDrawn(null));
    });

    const view = (p: Section) => {
        switch (p) {
            case "computer":
                return <ComputerView agent={agent} />;
            case "pages":
                return <Pages pages={pages} name={agent.state.settings?.name ?? "your agent"} onOpened={() => setOpen(false)} />;
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
            <div class={styles.split} classList={{ [styles.open!]: !!pages.shown(), [styles.extended!]: !!pages.shown() && (extended() || phone()) }}>
                <div class={styles.chatPane} inert={!!pages.shown() && (extended() || phone())}>
                    <div class={styles.chat}>
                        <Chat agent={agent} face={face} pages={pages} onMenu={() => setOpen(true)} />
                    </div>
                </div>
                <div class={styles.pagePane} ref={pagePane} inert={!pages.shown()}>
                    <Show when={drawn()}>
                        {(page) => <PageView page={page()} pages={pages} extended={extended()} phone={phone()} onExtend={() => setExtended((x) => !x)} onClose={pages.close} />}
                    </Show>
                </div>
            </div>
            {/* closing the modal unmounts the page, which hands back the computer */}
            <PaperModal open={open()} onClose={() => setOpen(false)} title={title()} size="full" noPadding>
                <PaperFlex class={styles.layout} direction={phone() ? "column" : "row"} minHeight={0}>
                    <PaperMenu name="ai-pages" aria-label="Menu" horizontal={phone()} value={page()} onValueChange={(v) => setPage(v as Section)}>
                        <For each={SECTIONS}>
                            {(p) => (
                                <PaperMenuItem value={p.id} icon={p.icon}>
                                    {p.title}
                                </PaperMenuItem>
                            )}
                        </For>
                    </PaperMenu>
                    <PaperFlex flex minWidth={0} minHeight={0} scrollable="y" padding={shown() === "computer" || shown() === "pages" || shown() === "tools" || shown() === "access" ? undefined : "double"}>
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
