import { type Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { PaperText, PaperButton, PaperIcon, getVarCss } from "@paperboard-dev/paperui";
import { shellApi, logToMain } from "../../lib/shell";

// Tabs that have no panel files dir — the folder button opens .paperboard/ for these
const NON_PANEL_TABS = new Set(["landing", "library", "settings"]);

// width of OS caption buttons overlaying the bar edge
const WINDOWS_CAPTION_FALLBACK = 140;

const TopBar: Component<{
    getComputerId: () => string;
    getSelectedTab: () => string;
}> = (props) => {
    const [updateReady, setUpdateReady] = createSignal<string | null>(null);
    const [captionReserve, setCaptionReserve] = createSignal(0);
    const [leftReserve, setLeftReserve] = createSignal(12);
    const [versionLabel, setVersionLabel] = createSignal<string | null>(null);

    onMount(() => {
        const ipc = (window as any).electron?.ipcRenderer;
        if (ipc?.on) {
            const handler = (_: any, data: { version?: string | null }) => {
                setUpdateReady(data?.version ?? "new version");
            };
            ipc.on("app-update-downloaded", handler);
            onCleanup(() => ipc.removeListener?.("app-update-downloaded", handler));
        }

        // Window Controls Overlay: exact caption-button geometry so the
        // buttons sit left of minimize/maximize/close instead of under them.
        const wco = (navigator as any).windowControlsOverlay;
        if (wco?.getTitlebarAreaRect) {
            const update = () => {
                try {
                    const rect = wco.getTitlebarAreaRect();
                    setCaptionReserve(
                        Math.max(0, window.innerWidth - rect.x - rect.width),
                    );
                } catch (err) { console.error("[TopBar] op failed:", err); }
            };
            update();
            wco.addEventListener?.("geometrychange", update);
            onCleanup(() => wco.removeEventListener?.("geometrychange", update));
        } else if (navigator.userAgent.includes("Windows")) {
            setCaptionReserve(WINDOWS_CAPTION_FALLBACK);
        }

        // Left side: macOS traffic lights overlay the bar's top-left, so the
        // version label starts after them; everywhere else it hugs the edge.
        const wcoRect =
            (navigator as any).windowControlsOverlay?.getTitlebarAreaRect?.();
        if (wcoRect && typeof wcoRect.x === "number" && wcoRect.x > 0) {
            setLeftReserve(wcoRect.x + 12);
        } else if (navigator.userAgent.includes("Mac")) {
            setLeftReserve(84);
        }

        // "3.0.0-alpha" -> "Alpha 3" (trailing .0s trimmed, tag capitalized)
        shellApi
            .getAppVersion()
            .then((raw) => {
                const dash = raw.indexOf("-");
                if (dash < 0) {
                    setVersionLabel(raw);
                    return;
                }
                const core = raw.slice(0, dash).split(".");
                while (core.length > 1 && core[core.length - 1] === "0") {
                    core.pop();
                }
                const tag = raw.slice(dash + 1);
                setVersionLabel(
                    `${tag.charAt(0).toUpperCase()}${tag.slice(1)} ${core.join(".")}`,
                );
            })
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
                        left: `${leftReserve()}px`,
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
                            (window as any).electron?.ipcRenderer?.send("quit-and-install")
                        }>
                        Restart to update
                    </PaperButton>
                </Show>
            </div>
        </header>
    );
};

export default TopBar;
