import GameOptions from "./components/GameOptions";
import { createEffect, createMemo, createSignal, onMount, onCleanup, untrack, For, Index, Show } from "solid-js";
import { tabIds } from "./lib/tabIds";
import {
    PaperPanel, PaperPresence, PaperButton, PaperIcon, PaperQuote, PaperLoader, PaperFlex, PaperText,
    PaperSlidePage, getVar,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import { serversBridge, selectedServerId, selectedServer, openServer } from "./lib/api";
import { loadServerConfig } from "./lib/server";
import { createCompact } from "./lib/compact";
import type { ServersState } from "./service";
import ServersHome from "./components/ServersHome";
import { serverSoftware, serverVersion, gameSettings } from "./lib/server";
import { gameFor } from "./games";
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

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");
    // Finish Setup fades the server's page in; opening a set-up server shows it at once
    const [setUpHere, setSetUpHere] = createSignal(false);
    // set when a plugin's Configure button asks the Files tab to open its settings
    const [filesReveal, setFilesReveal] = createSignal<PaperFileReveal | null>(null);

    // unknown until apply() reads the server's game: the state bridge can
    // hydrate first, and another game's describe() refuses this server's software
    const [gameId, setGameId] = createSignal<string | null>(null);
    const described = createMemo(() => {
        const id = gameId();
        return id ? gameFor(id).describe({ software: serverSoftware(), version: serverVersion(), settings: gameSettings() }) : null;
    });
    const features = () => {
        const shown = described();
        if (!shown) throw new Error("The server's game is not known yet");
        return shown;
    };
    const shownTabs = tabIds(() => described()?.tabs ?? []);
    const hasTab = (id: string) => features().tabs.some((tab) => tab.id === id);
    const tabContext = {
        active: activeTab,
        hasTab,
        openTab: setActiveTab,
        revealFiles: (reveal: PaperFileReveal) => { setActiveTab("files"); setFilesReveal({ ...reveal }); },
    };
    const gameUI = createMemo(() => {
        const id = gameId();
        return id ? gameUIFor(id).create(tabContext) : null;
    });
    const renderTab = (id: string, owner: "shared" | "game") => {
        if (owner === "game") return gameUI()!.tab(id);
        switch (id) {
            case "files": return <Files reveal={filesReveal()} />;
            case "logs": return <Logs />;
            case "backups": return <Backups active={activeTab() === id} whileRunning={features().backupWhileRunning} />;
            case "automation": return <Automation />;
            default: {
                // any other shared tab lists the game's options placed on it
                if (!features().options.some((option) => (option.tab ?? "options") === id)) throw new Error(`Shared tab has no renderer: ${id}`);
                return <GameOptions tab={features().tabs.find((tab) => tab.id === id)!} fields={features().options} whileRunning={features().optionsWhileRunning} />;
            }
        }
    };
    createEffect(() => {
        if (described() && !hasTab(activeTab())) setActiveTab("overview");
    });

    const [servers, setServers] = createSignal<ServersState | null>(null);
    const [failure, setFailure] = createSignal("");

    // Each server is a document of its own (see lib/api). On a phone the
    // server is a page that slides in over the list: it opens before the
    // server's document loads inside it, and a document opened on a server
    // starts with its page already open. Going back slides the page out over
    // the list that is already underneath, then lets the server's page go.
    const compact = createCompact();
    const [shown, setShown] = createSignal<string | null>(selectedServerId);
    const [pageOpen, setPageOpen] = createSignal(selectedServerId !== null);
    // set once the page has slid away: this document no longer shows its server
    const [retired, setRetired] = createSignal(false);
    const serverHere = () => selectedServerId !== null && !retired();
    const shownName = () => servers()?.servers.find((server) => server.id === shown())?.name ?? "";
    let navigation: ReturnType<typeof setTimeout> | undefined;
    const openServerPage = (id: string) => {
        if (!compact()) {
            openServer(id);
            return;
        }
        setShown(id);
        setPageOpen(true);
        if (serverHere() && id === selectedServerId) return;
        // the page has slid in over the list; the server's document loads inside it
        navigation = setTimeout(() => openServer(id), slideMs());
    };
    const closeServerPage = () => {
        clearTimeout(navigation);
        setPageOpen(false);
        const closed = shown();
        setTimeout(() => {
            if (pageOpen() || shown() !== closed) return;
            setShown(null);
            if (selectedServerId === null || retired()) return;
            setRetired(true);
            const url = new URL(window.location.href);
            url.searchParams.delete("server");
            window.history.replaceState(window.history.state, "", url.href);
        }, slideMs());
    };
    const fail = (what: string, err: unknown) => {
        console.error(`[App] ${what} failed:`, err);
        setFailure(err instanceof Error ? err.message : String(err));
    };
    const apply = (state: ServersState) => {
        // the server's game and setup state first: the page never renders
        // the wrong game, or the wizard for a server that is set up
        if (selectedServerId) {
            const server = selectedServer(state);
            gameFor(server.game);
            setGameId(server.game);
            // a wizard on screen stays until its Finish Setup, even when an
            // install marks the server set up underneath it
            setConfigured((shown) => (shown === false ? false : server.configured));
        }
        setServers(state);
    };
    const load = async () => {
        try {
            apply(await serversBridge.refreshState());
            if (selectedServerId) await loadServerConfig();
        } catch (err) { fail("loading the servers", err); }
    };
    onMount(() => {
        const off = serversBridge.onStateChange((_patch, full) => {
            try { apply(full); } catch (err) { fail("applying the servers' state", err); }
        });
        onCleanup(off);
        void load();
    });

    // the server's own page: its setup wizard until it is set up, then its menu and tabs
    const serverView = () => (
        <Show
            when={configured()}
            fallback={
                // the wizard has no menu, so a wide layout keeps a way back to the servers
                <PaperFlex direction="column" fullWidth fullHeight>
                    <Show when={!compact()}>
                        <PaperFlex direction="row" align="center" gap="half" padding="half">
                            <PaperButton icon variant="text" title="Back to Servers" aria-label="Back to Servers" onClick={() => openServer(null)}>
                                <PaperIcon>arrow_back</PaperIcon>
                            </PaperButton>
                            <PaperText preset="title">{selectedServer(servers()!).name}</PaperText>
                        </PaperFlex>
                    </Show>
                    <PaperFlex direction="column" fullWidth fullHeight>
                        {gameUI()!.setup({
                            get initialSoftware() { return selectedServer(servers()!).state.serverSoftware; },
                            get initialVersion() { return selectedServer(servers()!).state.serverVersion; },
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
                        if (val === HOME_ENTRY) openServer(null);
                        else setActiveTab(String(val));
                    }}
                >
                    {/* a phone leaves the server with the page's back button, under the server's name */}
                    <Show when={!compact()}>
                        <PaperMenuItem value={HOME_ENTRY} icon="arrow_back">
                            All servers
                        </PaperMenuItem>
                        <PaperMenuLabel>{selectedServer(servers()!).name}</PaperMenuLabel>
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
                        {(id) => {
                            const tab = () => features().tabs.find((t) => t.id === id)!;
                            const owner = untrack(() => tab().owner);
                            return <PaperInterfaceItem value={id} variant={(compact() && tab().compactVariant) || tab().variant} width={tab().width}>
                                {/* made once; its props follow the features, so a state change never remounts the tab */}
                                {untrack(() => renderTab(id, owner))}
                            </PaperInterfaceItem>;
                        }}
                    </For>
                </PaperInterfaceGroup>
            </PaperPanel>
            </PaperPresence>
        </Show>
    );

    const loading = () => (
        // centred, and only after a moment: opening a server reloads the page
        <PaperFlex fullWidth fullHeight align="center" justify="center">
            <PaperLoader loaderStatus="indeterminate" delay={400} label="Loading servers" />
        </PaperFlex>
    );

    return (
        <Show when={!failure()} fallback={<PaperQuote variant="danger" title="Servers could not be loaded" role="alert">{failure()}<PaperButton onClick={() => openServer(null)}>Servers</PaperButton></PaperQuote>}>
        <Show
            when={compact()}
            fallback={
                <Show when={servers()} fallback={loading()}>
                    <Show when={serverHere()} fallback={<ServersHome state={servers()!} onOpen={openServerPage} />}>
                        {serverView()}
                    </Show>
                </Show>
            }
        >
            <Show when={servers()}>
                <ServersHome state={servers()!} onOpen={openServerPage} />
            </Show>
            <PaperSlidePage enabled open={pageOpen()} position="fixed" title={shownName()} onBack={closeServerPage}>
                <Show when={shown()}>
                    {(id) => (
                        <Show when={servers() && serverHere() && id() === selectedServerId} fallback={loading()}>
                            {serverView()}
                        </Show>
                    )}
                </Show>
            </PaperSlidePage>
        </Show>
        </Show>
    );
}
