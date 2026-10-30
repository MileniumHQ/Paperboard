import GameOptions from "./components/GameOptions";
import { createEffect, createMemo, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
    PaperPanel, PaperButton, PaperModal, PaperQuote, PaperLoader, PaperFlex, PaperText,
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

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");
    // set when a plugin's Configure button asks the Files tab to open its settings
    const [filesReveal, setFilesReveal] = createSignal<PaperFileReveal | null>(null);

    const [gameId, setGameId] = createSignal(defaultGame.id);
    const features = createMemo(() => gameFor(gameId()).describe({ software: serverSoftware(), version: serverVersion(), settings: gameSettings() }));
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
            case "options": return <GameOptions fields={features().options} />;
            case "files": return <Files reveal={filesReveal()} />;
            case "logs": return <Logs />;
            case "backups": return <Backups active={activeTab() === id} />;
            default: throw new Error(`Shared tab has no renderer: ${id}`);
        }
    };
    createEffect(() => {
        if (!hasTab(activeTab())) setActiveTab("overview");
    });

    const [servers, setServers] = createSignal<ServersState | null>(null);
    const [failure, setFailure] = createSignal("");
    const apply = (state: ServersState) => {
        setServers(state);
        if (selectedServerId) {
            const server = selectedServer(state);
            gameFor(server.game);
            setGameId(server.game);
            setConfigured(server.configured);
        }
    };
    const load = async () => {
        try {
            apply(await serversBridge.refreshState());
            if (selectedServerId) await loadServerConfig();
        } catch (err) { setFailure(err instanceof Error ? err.message : String(err)); }
    };
    onMount(() => {
        const off = serversBridge.onStateChange((_patch, full) => {
            try { apply(full); } catch (err) { setFailure(err instanceof Error ? err.message : String(err)); }
        });
        onCleanup(off);
        void load();
    });

    return (
        <Show when={!failure()} fallback={<PaperQuote variant="danger" title="Servers could not be loaded" role="alert">{failure()}<PaperButton onClick={() => openServer(null)}>Servers</PaperButton></PaperQuote>}>
        <Show when={servers()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading servers" />}>
        <Show when={selectedServerId} fallback={<ServersHome state={servers()!} />}>
        <PaperFlex direction="column" fullWidth fullHeight>
            <PaperFlex direction="row" align="center" gap="half" padding="half">
                <PaperButton variant="text" onClick={() => openServer(null)}>Back to Servers</PaperButton>
                <PaperText>{selectedServer(servers()!).name}</PaperText>
            </PaperFlex>
            <Show
                when={configured()}
                fallback={<ServersHome state={servers()!} />}
            >
                <PaperPanel>
                    <PaperMenu
                        name="serverMenu"
                        value={activeTab()}
                        onValueChange={(val) => setActiveTab(String(val))}
                    >
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
                        <For each={features().tabs}>
                            {(tab) => <PaperInterfaceItem value={tab.id} variant={tab.variant} width={tab.width}>
                                {renderTab(tab.id, tab.owner)}
                            </PaperInterfaceItem>}
                        </For>
                    </PaperInterfaceGroup>
                </PaperPanel>
            </Show>
            <PaperModal open={configured() === false} title="Set up server" size="large" noPadding onClose={() => openServer(null)}>
                <PaperFlex direction="column" height="panel-height-large" fullWidth>
                    {gameUI().setup({
                        get initialSoftware() { return selectedServer(servers()!).state.serverSoftware; },
                        get initialVersion() { return selectedServer(servers()!).state.serverVersion; },
                        onComplete: () => setConfigured(true),
                    })}
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
        </Show>
        </Show>
        </Show>
    );
}
