import GameOptions from "./components/GameOptions";
import { createEffect, createMemo, createSignal, onMount, onCleanup, untrack, For, Show } from "solid-js";
import { tabIds } from "./lib/tabIds";
import {
    PaperPanel, PaperButton, PaperIcon, PaperQuote, PaperLoader, PaperFlex, PaperText,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import { serversBridge, selectedServerId, selectedServer, openServer } from "./lib/api";
import { loadServerConfig } from "./lib/server";
import type { ServersState } from "./service";
import ServersHome from "./components/ServersHome";
import { serverSoftware, serverVersion, gameSettings } from "./lib/server";
import { defaultGame, gameFor } from "./games";
import { gameUIFor } from "./games/ui";
import Files from "./components/Files";
import Backups from "./components/Backups";
import Logs from "./components/Logs";
import type { PaperFileReveal } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

// the menu entry that leaves the server for the home screen
const HOME_ENTRY = "home";

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");
    // set when a plugin's Configure button asks the Files tab to open its settings
    const [filesReveal, setFilesReveal] = createSignal<PaperFileReveal | null>(null);

    const [gameId, setGameId] = createSignal(defaultGame.id);
    const features = createMemo(() => gameFor(gameId()).describe({ software: serverSoftware(), version: serverVersion(), settings: gameSettings() }));
    const shownTabs = tabIds(() => features().tabs);
    const hasTab = (id: string) => features().tabs.some((tab) => tab.id === id);
    const tabContext = {
        active: activeTab,
        hasTab,
        openTab: setActiveTab,
        revealFiles: (reveal: PaperFileReveal) => { setActiveTab("files"); setFilesReveal({ ...reveal }); },
    };
    const gameUI = createMemo(() => gameUIFor(gameId()).create(tabContext));
    const renderTab = (id: string, owner: "shared" | "game") => {
        if (owner === "game") return gameUI().tab(id);
        switch (id) {
            case "files": return <Files reveal={filesReveal()} />;
            case "logs": return <Logs />;
            case "backups": return <Backups active={activeTab() === id} whileRunning={features().backupWhileRunning} />;
            default: {
                // any other shared tab lists the game's options placed on it
                if (!features().options.some((option) => (option.tab ?? "options") === id)) throw new Error(`Shared tab has no renderer: ${id}`);
                return <GameOptions tab={features().tabs.find((tab) => tab.id === id)!} fields={features().options} whileRunning={features().optionsWhileRunning} />;
            }
        }
    };
    createEffect(() => {
        if (!hasTab(activeTab())) setActiveTab("overview");
    });

    const [servers, setServers] = createSignal<ServersState | null>(null);
    const [failure, setFailure] = createSignal("");
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

    return (
        <Show when={!failure()} fallback={<PaperQuote variant="danger" title="Servers could not be loaded" role="alert">{failure()}<PaperButton onClick={() => openServer(null)}>Servers</PaperButton></PaperQuote>}>
        <Show when={servers()} fallback={<PaperLoader loaderStatus="indeterminate" delay={400} label="Loading servers" />}>
        <Show when={selectedServerId} fallback={<ServersHome state={servers()!} />}>
            <Show
                when={configured()}
                fallback={
                    // the wizard has no menu, so it keeps a way back to the servers
                    <PaperFlex direction="column" fullWidth fullHeight>
                        <PaperFlex direction="row" align="center" gap="half" padding="half">
                            <PaperButton icon variant="text" title="Back to Servers" aria-label="Back to Servers" onClick={() => openServer(null)}>
                                <PaperIcon>arrow_back</PaperIcon>
                            </PaperButton>
                            <PaperText preset="title">{selectedServer(servers()!).name}</PaperText>
                        </PaperFlex>
                        <PaperFlex direction="column" fullWidth fullHeight>
                            {gameUI().setup({
                                get initialSoftware() { return selectedServer(servers()!).state.serverSoftware; },
                                get initialVersion() { return selectedServer(servers()!).state.serverVersion; },
                                onComplete: () => setConfigured(true),
                            })}
                        </PaperFlex>
                    </PaperFlex>
                }
            >
                <PaperPanel>
                    <PaperMenu
                        name="serverMenu"
                        value={activeTab()}
                        onValueChange={(val) => {
                            if (val === HOME_ENTRY) openServer(null);
                            else setActiveTab(String(val));
                        }}
                    >
                        <PaperMenuItem value={HOME_ENTRY} icon="arrow_back">
                            All servers
                        </PaperMenuItem>
                        <PaperMenuLabel>{selectedServer(servers()!).name}</PaperMenuLabel>
                        <For each={features().tabs}>
                            {(tab, index) => <>
                                <Show when={tab.group && tab.group !== features().tabs[index() - 1]?.group}>
                                    <PaperMenuLabel>{tab.group}</PaperMenuLabel>
                                </Show>
                                <PaperMenuItem value={tab.id} icon={tab.icon}>{tab.label}</PaperMenuItem>
                            </>}
                        </For>
                    </PaperMenu>

                    <PaperInterfaceGroup value={activeTab()}>
                        <For each={shownTabs()}>
                            {(id) => {
                                const tab = () => features().tabs.find((t) => t.id === id)!;
                                const owner = untrack(() => tab().owner);
                                return <PaperInterfaceItem value={id} variant={tab().variant} width={tab().width}>
                                    {renderTab(id, owner)}
                                </PaperInterfaceItem>;
                            }}
                        </For>
                    </PaperInterfaceGroup>
                </PaperPanel>
            </Show>
        </Show>
        </Show>
        </Show>
    );
}
