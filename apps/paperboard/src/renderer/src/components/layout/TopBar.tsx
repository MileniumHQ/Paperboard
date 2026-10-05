import { type Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { PaperText, PaperButton, PaperIcon, getVarCss } from "@paperboard-dev/paperui";
import { shellApi, logToMain, shellIpc, isBrowserShell } from "../../lib/shell";
import { versionLabel as formatVersionLabel } from "../../lib/versionLabel";
import { leftReserve, rightReserve, type OverlayLike } from "./titlebarInsets";

// Tabs that have no panel files dir — the folder button opens .paperboard/ for these
const NON_PANEL_TABS = new Set(["landing", "library", "settings"]);

const TopBar: Component<{
    getComputerId: () => string;
    getSelectedTab: () => string;
}> = (props) => {
    const [updateReady, setUpdateReady] = createSignal<string | null>(null);
    const [captionReserve, setCaptionReserve] = createSignal(0);
    const [labelInset, setLabelInset] = createSignal(12);
    const [versionLabel, setVersionLabel] = createSignal<string | null>(null);

    onMount(() => {
        // browser mode has no updater: the app updates when it next runs
        // as a window, so there is nothing to listen for
        if (isBrowserShell()) {
            console.warn(
                "Paperboard browser mode has no sign-in. THIS IS A DEV TOOL AND SHOULD NOT BE USED " +
                    "outside development on a trusted machine, and never exposed on a network.",
            );
        } else {
            const ipc = shellIpc();
            const handler = (_: unknown, data: { version?: string | null }) => {
                setUpdateReady(data?.version ?? "new version");
            };
            ipc.on("app-update-downloaded", handler);
            onCleanup(() => ipc.removeListener("app-update-downloaded", handler));
        }

        // Window Controls Overlay: exact caption-button geometry so the
        // buttons sit left of minimize/maximize/close instead of under them;
        // macOS traffic lights push the version label right instead.
        const wco = (navigator as any).windowControlsOverlay as OverlayLike | undefined;
        const update = () => {
            setCaptionReserve(rightReserve(wco, window.innerWidth, navigator.userAgent, isBrowserShell()));
            setLabelInset(leftReserve(wco, navigator.userAgent, isBrowserShell()));
        };
        update();
        const target = wco as unknown as EventTarget | undefined;
        target?.addEventListener?.("geometrychange", update);
        onCleanup(() => target?.removeEventListener?.("geometrychange", update));

        shellApi
            .getAppVersion()
            .then((raw) => setVersionLabel(formatVersionLabel(raw)))
            .catch((err) => console.error("[TopBar] failed to read app version:", err));
    });

    const handleFolder = () => {
        const computerId = props.getComputerId();
        // Local: panel's files dir (or .paperboard/ when no panel tab).
        // Remote: same, over WebDAV (root when no panel tab).
        const tab = props.getSelectedTab();
        const panelId = NON_PANEL_TABS.has(tab) ? undefined : tab;
        shellApi
            .openPanelFolder(computerId, panelId)
            .then((ok) => {
                if (!ok) logToMain("warn", `Folder open failed for computer "${computerId}"`);
            })
            .catch((err) => logToMain("error", "Failed to open panel folder:", err));
    };

    return (
        <header
            style={{
                height: "38px",
                width: "100%",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "-webkit-app-region": "drag",
                "user-select": "none",
                background: getVarCss("surface-sunken"),
                "border-bottom": `${getVarCss("border-width")} solid ${getVarCss("border")}`,
                position: "relative",
                "flex-shrink": 0,
                "z-index": 2000,
            }}
        >
            <PaperText
                weight={800}
                size={2}
                color="text-subtle"
                style={{ "pointer-events": "none" }}
            >
                Paperboard
            </PaperText>
            <Show when={versionLabel() !== null}>
                <div
                    style={{
                        position: "absolute",
                        left: `${labelInset()}px`,
                        display: "flex",
                        "align-items": "center",
                        "-webkit-app-region": "no-drag",
                    }}
                >
                    <PaperText size={1} color="text-subtle">
                        {versionLabel()}
                    </PaperText>
                </div>
            </Show>
            <div
                style={{
                    position: "absolute",
                    right: `${8 + captionReserve()}px`,
                    display: "flex",
                    gap: "6px",
                    "align-items": "center",
                    "-webkit-app-region": "no-drag",
                }}
            >
                <PaperButton size="tiny"
                    icon
                    title="Open panel folder"
                    aria-label="Open panel folder"
                    onClick={handleFolder}>
                    <PaperIcon>folder_open</PaperIcon>
                </PaperButton>
                <Show when={updateReady() !== null}>
                    <PaperButton
                        title={`Restart to install ${updateReady()}`}
                        onClick={() =>
                            shellIpc().send("quit-and-install")
                        }>
                        Restart to update
                    </PaperButton>
                </Show>
            </div>
        </header>
    );
};

export default TopBar;
