import {
    type Component,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperText,
    type ThemeMode,
} from "@paperboard-dev/paperui";
import {
    PANEL_LIBRARY_URL,
    type InstalledPanelMedia,
    type PanelItem,
} from "@paperboard-dev/paperapi";
import { logToMain } from "../../lib/shell";
import { parseLibraryMessage, shellToLibrary } from "../../lib/libraryFrame";

// Bounded retry window: an embedded library answers the hello in
// milliseconds. Silence means the page never loaded (offline, blocked), and
// the shell shows a reload action instead of a blank frame.
const LIBRARY_CONNECT_TIMEOUT_MS = 10_000;

export interface LibraryFrameProps {
    /** Library tab is the selected tab; mounting is lazy on first activation. */
    active: boolean;
    theme: ThemeMode;
    /** Installed panels for the active computer (daemon facts, not registry). */
    installed: PanelItem[];
    onInstall: (panelId: string) => Promise<void>;
    onOpen: (panelId: string) => void;
    /** Reads an installed panel's icon and store listing from its own files. */
    loadMedia: (panelId: string, full: boolean) => Promise<InstalledPanelMedia>;
    /** Overridable for tests/dev; defaults to the registry origin's /library/. */
    libraryUrl?: string;
}

const LibraryFrame: Component<LibraryFrameProps> = (props) => {
    const [mounted, setMounted] = createSignal(false);
    const [connected, setConnected] = createSignal(false);
    const [failure, setFailure] = createSignal(false);
    const [reloadToken, setReloadToken] = createSignal(0);
    let frame: HTMLIFrameElement | undefined;

    // VITE_PANEL_LIBRARY_URL lets `bun run dev` point at the library's own
    // dev server; production builds without it use the registry origin.
    const libraryUrl = () => {
        const url =
            props.libraryUrl ??
            import.meta.env.VITE_PANEL_LIBRARY_URL ??
            PANEL_LIBRARY_URL;
        return url.endsWith("/") ? url : `${url}/`;
    };
    const libraryOrigin = () =>
        new URL(libraryUrl(), window.location.href).origin;

    const reply = (message: unknown) => {
        frame?.contentWindow?.postMessage(message, libraryOrigin());
    };

    const handleInstall = async (requestId: string, panelId: string) => {
        try {
            await props.onInstall(panelId);
            reply(shellToLibrary.installResult({ requestId, panelId, ok: true }));
        } catch (err: any) {
            logToMain("error", `Panel library install failed for ${panelId}:`, err);
            reply(
                shellToLibrary.installResult({
                    requestId,
                    panelId,
                    ok: false,
                    error: err?.message ? String(err.message) : "install failed",
                }),
            );
        }
    };

    // Only installed panels on the active computer can be read: the library
    // names a panel id, never a path, and the files come from its manifest.
    const handleMedia = async (requestId: string, panelId: string, full: boolean) => {
        if (!props.installed.some((panel) => panel.id === panelId)) {
            reply(shellToLibrary.mediaResult({ requestId, panelId, ok: false, error: "not installed" }));
            return;
        }
        try {
            const media = await props.loadMedia(panelId, full);
            reply(shellToLibrary.mediaResult({ requestId, panelId, ok: true, media }));
        } catch (err: any) {
            logToMain("warn", `Panel library media unavailable for ${panelId}:`, err);
            reply(
                shellToLibrary.mediaResult({
                    requestId,
                    panelId,
                    ok: false,
                    error: err?.message ? String(err.message) : "media unavailable",
                }),
            );
        }
    };

    const receive = (event: MessageEvent) => {
        if (!frame?.contentWindow) return;
        const message = parseLibraryMessage(event, {
            sourceWindow: frame.contentWindow,
            origin: libraryOrigin(),
        });
        if (!message) return;
        if (message.type === "paperboard:library-hello") {
            setConnected(true);
            setFailure(false);
            reply(shellToLibrary.connected(props.theme, props.installed));
        } else if (message.type === "paperboard:library-install") {
            void handleInstall(message.requestId, message.panelId);
        } else if (message.type === "paperboard:library-media") {
            void handleMedia(message.requestId, message.panelId, message.full);
        } else if (message.type === "paperboard:library-open") {
            props.onOpen(message.panelId);
        }
    };

    // Lazy mount: launching Paperboard must not load remote content the
    // user never opened. Once mounted the frame stays alive so library
    // state survives tab switches.
    createEffect(() => {
        if (props.active) setMounted(true);
    });

    createEffect(() => {
        if (!mounted() || !props.active || connected() || failure()) return;
        const timer = setTimeout(
            () => setFailure(true),
            LIBRARY_CONNECT_TIMEOUT_MS,
        );
        onCleanup(() => clearTimeout(timer));
    });

    // Installed facts are the daemon's; push every change so the library's
    // cards cannot go stale after an install/uninstall elsewhere. The theme
    // rides along so a settings change reaches the embedded page too.
    createEffect(() => {
        const installed = props.installed;
        const theme = props.theme;
        if (!connected()) return;
        if (!frame?.contentWindow) return;
        reply(shellToLibrary.installed(theme, installed));
    });

    onMount(() => {
        window.addEventListener("message", receive);
        onCleanup(() => window.removeEventListener("message", receive));
    });

    return (
        <PaperFlex
            direction="column"
            fullWidth
            fullHeight
            style={{ flex: "1", position: "relative", overflow: "hidden" }}
        >
            <Show when={mounted()}>
                <iframe
                    ref={frame}
                    title="Panel Library"
                    src={`${libraryUrl()}?r=${reloadToken()}`}
                    sandbox="allow-scripts allow-same-origin allow-downloads"
                    style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        display: props.active ? "block" : "none",
                    }}
                />
            </Show>
            <Show when={failure()}>
                <PaperFlex
                    direction="column"
                    center
                    fullWidth
                    fullHeight
                    gap="half"
                    style={{ position: "absolute", inset: "0" }}
                >
                    <PaperText role="status">
                        Couldn't reach the panel library.
                    </PaperText>
                    <PaperButton
                        onClick={() => {
                            setFailure(false);
                            setConnected(false);
                            setReloadToken((token) => token + 1);
                        }}
                    >
                        Reload library
                    </PaperButton>
                </PaperFlex>
            </Show>
        </PaperFlex>
    );
};

export default LibraryFrame;
