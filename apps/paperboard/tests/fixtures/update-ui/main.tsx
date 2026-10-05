import "@paperboard-dev/paperui/style.css";
import { render } from "solid-js/web";
import { PaperProvider, PaperFlex } from "@paperboard-dev/paperui";
import { type AppUpdateState } from "../../../src/shared/appUpdate";
import { useAppUpdate } from "../../../src/renderer/src/hooks/useAppUpdate";
import ComputerRail from "../../../src/renderer/src/components/computer/ComputerRail";
import AppUpdateModal from "../../../src/renderer/src/components/layout/AppUpdateModal";
import TopBar from "../../../src/renderer/src/components/layout/TopBar";
import LandingView from "../../../src/renderer/src/components/computer/LandingView";

// A controllable preload transport for browser semantics and late hydration.
// Native discovery, download and installation use a separate Electron fixture.
const listeners = new Set<(event: unknown, state: AppUpdateState) => void>();
const actions: string[] = [];
let resolveHydration!: (value: AppUpdateState) => void;
const hydration = new Promise<AppUpdateState>((resolve) => { resolveHydration = resolve; });
(window as any).updateFixture = {
    emit(next: AppUpdateState) { for (const listener of listeners) listener({}, next); },
    hydrate(next: AppUpdateState) { resolveHydration(next); },
    actions,
    listeners: () => listeners.size,
};
(window as any).electron = { ipcRenderer: {
    invoke: async (channel: string) => {
        if (channel === "app-update-state") return hydration;
        if (channel === "app-version") return "0.1.0";
        actions.push(channel);
    },
    send: (channel: string) => actions.push(channel),
    on: (_channel: string, listener: (event: unknown, state: AppUpdateState) => void) => listeners.add(listener),
    removeListener: (_channel: string, listener: (event: unknown, state: AppUpdateState) => void) => listeners.delete(listener),
} };
function Fixture() {
    const update = useAppUpdate();
    return <PaperProvider styleBody><PaperFlex direction="column" style={{ width: "100vw", height: "100vh" }}>
        <TopBar updateState={update.state()} onOpenUpdate={() => update.setOpen(true)} getComputerId={() => "local"} getSelectedTab={() => "landing"} />
        <PaperFlex direction="row" style={{ flex: 1, "min-height": 0 }}>
        <ComputerRail computers={[{ id: "local", name: "This computer", host: "localhost", isLocal: true }]} value="local" onSelect={() => undefined} onAdd={() => undefined}
            updateState={update.state()} showUpdate onOpenUpdate={() => update.setOpen(true)} />
        <LandingView />
        </PaperFlex>
        <AppUpdateModal state={update.state()} open={update.open()} onClose={() => update.setOpen(false)} />
    </PaperFlex></PaperProvider>;
}
const dispose = render(() => <Fixture />, document.getElementById("root")!);
(window as any).updateFixture.dispose = dispose;
