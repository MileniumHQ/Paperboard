import { type Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { PaperText, PaperButton, PaperIcon, PaperModal } from "@mileniumhq/paperui";
import { shellApi, logToMain, isBrowserShell } from "../../lib/shell";
import { versionLabel as formatVersionLabel } from "../../lib/versionLabel";
import { isShellTab } from "../../lib/shellTabs";
import type { AppUpdateState } from "../../../../shared/appUpdate";
import type { UpdateQueueState } from "../../../../shared/updateQueue";
import UpdatesButton from "./UpdatesButton";
import { leftReserve, rightReserve, type OverlayLike } from "./titlebarInsets";
import styles from "./TopBar.module.css";


const TopBar: Component<{
    updateState: AppUpdateState;
    onOpenUpdate: () => void;
    // what Paperboard is updating, and what waits for something to stop
    updateQueue: UpdateQueueState;
    onReleaseUpdate: (keys: string[]) => Promise<void>;
    getComputerId: () => string;
    getSelectedTab: () => string;
    /** the phone layout: no window to drag, no caption buttons, no folders to open */
    mobile?: boolean;
    inert?: boolean;
}> = (props) => {
    const [captionReserve, setCaptionReserve] = createSignal(0);
    const [labelInset, setLabelInset] = createSignal(12);
    const [versionLabel, setVersionLabel] = createSignal<string | null>(null);
    // why the last folder didn't open; it stays in the modal as it fades out
    const [folderError, setFolderError] = createSignal("");
    const [folderErrorOpen, setFolderErrorOpen] = createSignal(false);
    const showFolderError = (message: string) => {
        setFolderError(message);
        setFolderErrorOpen(true);
    };

    onMount(() => {
        // browser mode has no updater: the app updates when it next runs
        // as a window, so there is nothing to listen for
        if (isBrowserShell()) {
            console.warn(
                "Paperboard browser mode has no sign-in. THIS IS A DEV TOOL AND SHOULD NOT BE USED " +
                    "outside development on a trusted machine, and never exposed on a network.",
            );
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
        // shell pages have no panel files dir: the folder button opens .paperboard/
        const panelId = isShellTab(tab) ? undefined : tab;
        shellApi
            .openPanelFolder(computerId, panelId)
            .then((result) => {
                if (result.opened) return;
                logToMain("warn", `Folder open failed for computer "${computerId}":`, result.error);
                showFolderError(result.error ?? "The folder couldn't be opened.");
            })
            .catch((err) => {
                logToMain("error", "Failed to open panel folder:", err);
                showFolderError(err instanceof Error ? err.message : String(err));
            });
    };

    return (
        <>
            <header
                inert={props.inert}
                class={styles.bar}
                classList={{ [styles.desktop]: !props.mobile }}
            >
                <PaperText
                    weight={800}
                    size={2}
                    color="text-muted"
                    class={styles.title}
                >
                    Paperboard
                </PaperText>
                <Show when={!props.mobile && versionLabel() !== null}>
                    <div class={styles.version} style={{ left: `${labelInset()}px` }}>
                        <PaperText preset="hint">
                            {versionLabel()}
                        </PaperText>
                    </div>
                </Show>
                <div
                    class={styles.controls}
                    style={{ right: `calc(var(--paper-uigap-threefourths) + ${props.mobile ? 0 : captionReserve()}px)` }}
                >
                    <Show when={!props.mobile}>
                        <PaperButton size="tiny"
                            icon
                            title="Open panel folder"
                            aria-label="Open panel folder"
                            onClick={handleFolder}>
                            <PaperIcon>folder_open</PaperIcon>
                        </PaperButton>
                    </Show>
                    <UpdatesButton state={props.updateQueue} onRelease={props.onReleaseUpdate} />
                    <Show when={props.updateState.status === "ready"}>
                        <PaperButton
                            size="tiny"
                            title={`Install ${props.updateState.version}`}
                            onClick={props.onOpenUpdate}>
                            Restart to update
                        </PaperButton>
                    </Show>
                </div>
            </header>
            <PaperModal
                open={folderErrorOpen()}
                onClose={() => setFolderErrorOpen(false)}
                title="Folder not opened"
                size="small"
                footer={<>
                    <PaperButton onClick={() => setFolderErrorOpen(false)}>Close</PaperButton>
                </>}
            >
                <PaperText preset="error" role="alert" breakWord>{folderError()}</PaperText>
            </PaperModal>
        </>
    );
};

export default TopBar;
