import GameOptions from "./components/GameOptions";
import { createEffect, createMemo, createSignal, on, onMount, onCleanup, untrack, ErrorBoundary, For, Index, Show, type Accessor } from "solid-js";
import { tabIds } from "./lib/tabIds";
import {
    PaperPanel, PaperPresence, PaperButton, PaperIcon, PaperLoader, PaperFlex, PaperText, PaperEmptyState, showError,
    PaperSlidePage, getVar,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    keepUnchanged,
    createPaperCompact,
} from "@mileniumhq/paperui";
import { serversState } from "./lib/api";
import { createServerPage, ServerContext } from "./lib/server";
import type { ServersState, ServerSummary } from "./service";
import ServersHome from "./components/ServersHome";
import RecoveryNotice from "./components/RecoveryNotice";
import { gameFor } from "./games";
import { errorMessage } from "./lib/failure";
import { gameUIFor } from "./games/ui";
import Files from "./components/Files";
import Backups from "./components/Backups";
import Automation from "./components/Automation";
import Logs from "./components/Logs";
import type { PaperFileReveal } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

// the menu entry that leaves the server for the home screen
const HOME_ENTRY = "home";

/** how long PaperUI's pages take to slide, which a page waits out before the next step */
function slideMs(): number {
    const duration = getVar("mid-transition");
    const value = parseFloat(duration);
    if (!Number.isFinite(value)) throw new Error(`The page transition is not a duration: "${duration}"`);
    return duration.endsWith("ms") ? value : value * 1000;
}

/** the server the address names: a page opened, or reloaded, on a server shows it */
const serverInAddress = () => new URL(window.location.href).searchParams.get("server");

export default function App() {
    const [servers, setServers] = createSignal<ServersState | null>(null);
    // the page failed and stands empty: it says so, and Try again goes back to the servers
    const [failed, setFailed] = createSignal(false);
    // The open server is this page's state, not its address: switching is a
    // change here, and the server's page is made again for the new server
    // (see serverPage). The address follows, so a reload opens the same one.
    const [selected, setSelected] = createSignal<string | null>(serverInAddress());
    createEffect(
        on(selected, (id) => {
            const url = new URL(window.location.href);
            if (id) url.searchParams.set("server", id);
            else url.searchParams.delete("server");
            if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
        }),
    );
    const fail = (what: string, err: unknown) => {
        console.error(`[App] couldn't ${what}:`, err);
        showError(`Couldn't ${what}`, errorMessage(err));
        setFailed(true);
    };

    // A tab holding work that leaving would lose (the Files editor's unsaved
    // edits) asks the person before it goes: every way out of the open tab
    // the panel controls waits for its answer, and staying keeps the tab.
    let leaveGuard: (() => Promise<boolean>) | null = null;
    const guardLeaving = (guard: () => Promise<boolean>) => {
        leaveGuard = guard;
        onCleanup(() => { if (leaveGuard === guard) leaveGuard = null; });
    };
    const leaveTab = (go: () => void) => {
        if (!leaveGuard) return go();
        leaveGuard().then((leave) => { if (leave) go(); }, (err) => fail("leave the tab", err));
    };

    // On a phone the server is a page that slides in over the list, and
    // going back slides it out over the list underneath before its server
    // lets go. A wide layout shows the server in place of the list.
    const compact = createPaperCompact();
    const [shown, setShown] = createSignal<string | null>(selected());
    const [pageOpen, setPageOpen] = createSignal(selected() !== null);
    const shownName = () => servers()?.servers.find((server) => server.id === shown())?.name ?? "";
    const known = (id: string) => servers()?.servers.some((server) => server.id === id) ?? false;
    const openServerPage = async (id: string) => {
        // a server just added is not in the list this page has yet
        if (!known(id)) {
            try {
                apply(await serversState.refresh());
            } catch (err) {
                fail("open the server", err);
            }
            if (!known(id)) return;
        }
        setSelected(id);
        setShown(id);
        setPageOpen(true);
    };
    const leaveServer = () => leaveTab(() => setSelected(null));
    const closeServerPage = () => {
        setPageOpen(false);
        const closed = shown();
        setTimeout(() => {
            if (pageOpen() || shown() !== closed) return;
            setShown(null);
            setSelected(null);
        }, slide());
    };
    // a page that can't tell how long it slides says so, instead of a tap doing nothing
    const slide = () => {
        try {
            return slideMs();
        } catch (err) {
            fail("slide the server's page", err);
            throw err;
        }
    };
    const apply = (state: ServersState) => {
        if (state.serversError) throw new Error(state.serversError);
        const open = selected();
        if (open && !state.servers.some((server) => server.id === open)) throw new Error("Choose a server that has not been removed");
        // each push is a fresh copy: a server it did not change keeps its card
        setServers((prev) => keepUnchanged(prev, state));
    };
    // a push before the first load is answered by the load
    let loaded = false;
    const load = async () => {
        try {
            apply(await serversState.refresh());
            loaded = true;
        } catch (err) { fail("load the servers", err); }
    };
    onMount(() => {
        const off = serversState.subscribe((full) => {
            if (!loaded) return;
            try { apply(full); } catch (err) { fail("apply the servers' state", err); }
        });
        onCleanup(off);
        void load();
    });
    const backToServers = () => {
        setFailed(false);
        setSelected(null);
        setShown(null);
        setPageOpen(false);
        void load();
    };

    // The open server's page: made for one server, with its own state, tabs
    // and dialogs, and dropped with everything it owns when another opens.
    const serverPage = (id: string) => {
        // App leaves a removed server before its summary goes (apply)
        const summary = createMemo<ServerSummary>((prev) => servers()?.servers.find((server) => server.id === id) ?? prev, servers()!.servers.find((server) => server.id === id)!);
        const server = createServerPage(summary);
        // a server left before it loaded says nothing over the next one's page
        let gone = false;
        onCleanup(() => (gone = true));
        server.refresh().then(() => server.loadServerConfig(), (err) => { if (!gone) fail("load the server", err); });
        return (
            <ServerContext.Provider value={server}>
                <Show when={server.loaded()} fallback={loading()}>
                    {untrack(() => serverView(server, summary))}
                </Show>
            </ServerContext.Provider>
        );
    };

    const serverView = (server: ReturnType<typeof createServerPage>, summary: Accessor<ServerSummary>) => {
        const [activeTab, setActiveTab] = createSignal("overview");
        // a wizard on screen stays until its Finish Setup, even when an
        // install marks the server set up underneath it
        const [configured, setConfigured] = createSignal(summary().configured);
        createEffect(on(() => summary().configured, (now) => setConfigured((shown) => (shown === false ? false : now)), { defer: true }));
        // Finish Setup fades the server's page in; opening a set-up server shows it at once
        const [setUpHere, setSetUpHere] = createSignal(false);
        // set when a plugin's Configure button asks the Files tab to open its settings
        const [filesReveal, setFilesReveal] = createSignal<PaperFileReveal | null>(null);
        const game = gameFor(summary().game);
        const features = createMemo(() => game.describe({ software: server.serverSoftware(), version: server.serverVersion(), settings: server.gameSettings() }));
        const shownTabs = tabIds(() => features().tabs);
        const hasTab = (tab: string) => features().tabs.some((t) => t.id === tab);
        const openTab = (tab: string) => {
            if (tab !== activeTab()) leaveTab(() => setActiveTab(tab));
        };
        const gameUI = gameUIFor(game.id).create({
            active: activeTab,
            hasTab,
            openTab,
            revealFiles: (reveal: PaperFileReveal) => { setActiveTab("files"); setFilesReveal({ ...reveal }); },
        });
        const renderTab = (tab: string, owner: "shared" | "game") => {
            if (owner === "game") return gameUI.tab(tab);
            switch (tab) {
                case "files": return <Files reveal={filesReveal()} guardLeaving={guardLeaving} />;
                case "logs": return <Logs />;
                case "backups": return <Backups active={activeTab() === tab} whileRunning={features().backupWhileRunning} />;
                case "automation": return <Automation />;
                default: {
                    // any other shared tab lists the game's options placed on it
                    if (!features().options.some((option) => (option.tab ?? "options") === tab)) throw new Error(`Shared tab has no renderer: ${tab}`);
                    return <GameOptions tab={features().tabs.find((t) => t.id === tab)!} fields={features().options} whileRunning={features().optionsWhileRunning} />;
                }
            }
        };
        // a version without the open tab falls back to the overview
        createEffect(
            on([features, activeTab], ([, tab]) => {
                if (!hasTab(tab)) setActiveTab("overview");
            }),
        );

        return (
            <Show
                when={configured()}
                fallback={
                    // the wizard has no menu, so a wide layout keeps a way back to the servers
                    <PaperFlex direction="column" fullWidth fullHeight>
                        <Show when={!compact()}>
                            <PaperFlex direction="row" align="center" gap="half" padding="half">
                                <PaperButton icon variant="text" title="Back to Servers" aria-label="Back to Servers" onClick={leaveServer}>
                                    <PaperIcon>arrow_back</PaperIcon>
                                </PaperButton>
                                <PaperText preset="title">{summary().name}</PaperText>
                            </PaperFlex>
                        </Show>
                        {/* a server that could not be set up can't run its wizard either */}
                        <Show when={server.initFailure() ?? server.recoveryBlock()}>
                            <PaperFlex padding="full">
                                <RecoveryNotice />
                            </PaperFlex>
                        </Show>
                        <PaperFlex direction="column" fullWidth fullHeight>
                            {gameUI.setup({
                                get initialSoftware() { return summary().state.serverSoftware; },
                                get initialVersion() { return summary().state.serverVersion; },
                                onComplete: () => { setSetUpHere(true); setConfigured(true); },
                            })}
                        </PaperFlex>
                    </PaperFlex>
                }
            >
                <PaperPresence when appear={setUpHere()} motion="fade">
                <PaperPanel>
                    <PaperMenu
                        name="serverMenu"
                        value={activeTab()}
                        onValueChange={(val) => {
                            if (val === HOME_ENTRY) leaveServer();
                            else openTab(String(val));
                        }}
                    >
                        {/* a phone leaves the server with the page's back button, under the server's name */}
                        <Show when={!compact()}>
                            <PaperMenuItem value={HOME_ENTRY} icon="arrow_back">
                                All servers
                            </PaperMenuItem>
                            <PaperMenuLabel>{summary().name}</PaperMenuLabel>
                        </Show>
                        {/* by position: describe() makes new tab objects whenever the state changes */}
                        <Index each={features().tabs}>
                            {(tab, index) => <>
                                <Show when={tab().group && tab().group !== features().tabs[index - 1]?.group}>
                                    <PaperMenuLabel>{tab().group}</PaperMenuLabel>
                                </Show>
                                <PaperMenuItem value={tab().id} icon={tab().icon}>{tab().label}</PaperMenuItem>
                            </>}
                        </Index>
                    </PaperMenu>

                    <PaperInterfaceGroup value={activeTab()}>
                        <For each={shownTabs()}>
                            {(tabId) => {
                                const tab = () => features().tabs.find((t) => t.id === tabId)!;
                                const owner = untrack(() => tab().owner);
                                return <PaperInterfaceItem value={tabId} variant={(compact() && tab().compactVariant) || tab().variant} width={tab().width}>
                                    {/* a tab that can't be drawn says why, instead of standing blank */}
                                    <ErrorBoundary
                                        fallback={(err, reset) => {
                                            console.error(`[App] the ${tabId} tab could not be drawn:`, err);
                                            showError(`Couldn't open ${untrack(tab).label}`, errorMessage(err));
                                            return (
                                                <PaperEmptyState icon="error" title="Couldn't load">
                                                    <PaperButton onClick={reset}>Try again</PaperButton>
                                                </PaperEmptyState>
                                            );
                                        }}
                                    >
                                        {/* made once; its props follow the features, so a state change never remounts the tab */}
                                        {untrack(() => renderTab(tabId, owner))}
                                    </ErrorBoundary>
                                </PaperInterfaceItem>;
                            }}
                        </For>
                    </PaperInterfaceGroup>
                </PaperPanel>
                </PaperPresence>
            </Show>
        );
    };

    // the server's page is made once per server and moved between the wide
    // layout and the phone's sliding page, so crossing the width keeps its
    // tab, its open player and its dialogs with what was typed in them
    const pageServer = createMemo(() => {
        const id = selected();
        return id !== null && servers() !== null && known(id) ? id : null;
    });
    const page = createMemo(() => {
        const id = pageServer();
        return id === null ? null : untrack(() => serverPage(id));
    });

    const loading = () => (
        // centred, and only after a moment: most servers load at once
        <PaperFlex fullWidth fullHeight align="center" justify="center">
            <PaperLoader loaderStatus="indeterminate" delay={400} label="Loading servers" />
        </PaperFlex>
    );

    return (
        <Show
            when={!failed()}
            fallback={
                <PaperEmptyState icon="error" title="Couldn't load">
                    <PaperButton onClick={backToServers}>Try again</PaperButton>
                </PaperEmptyState>
            }
        >
        <Show
            when={compact()}
            fallback={
                <Show when={servers()} fallback={loading()}>
                    <Show when={pageServer()} fallback={<ServersHome state={servers()!} onOpen={(id) => void openServerPage(id)} />}>
                        {/* its own box: the layout that lets go of it removes this, never the page moved out of it */}
                        <PaperFlex direction="column" fullWidth fullHeight>{page()}</PaperFlex>
                    </Show>
                </Show>
            }
        >
            <Show when={servers()}>
                <ServersHome state={servers()!} onOpen={(id) => void openServerPage(id)} />
            </Show>
            <PaperSlidePage enabled open={pageOpen()} position="fixed" title={shownName()} onBack={() => leaveTab(closeServerPage)}>
                <Show when={shown() !== null && shown() === pageServer()} fallback={loading()}>
                    <PaperFlex direction="column" fullWidth fullHeight>{page()}</PaperFlex>
                </Show>
            </PaperSlidePage>
        </Show>
        </Show>
    );
}
