import { createEffect, createSignal, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    type LoaderStatus,
} from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";
import { ensureJavaRuntime } from "../lib/ensureJava";
import InstallLoaders from "./InstallLoaders";
import { PANEL_ID } from "../service/types";
import { ACTION_IDS } from "../service/contract";
import {
    serverBridge,
    serverStatus,
    installProgress,
    setInstallProgress,
} from "../lib/server";
import {
    SOFTWARE_NAMES,
    getRequiredJavaVersion,
    type ServerSoftwareType,
} from "../lib/software";
import { listInstalledPlugins, uninstallAllPlugins } from "../lib/plugins";
import VersionPicker from "./VersionPicker";

// Versions: swap the server jar for a different software/version. This is a
// destructive boundary (world format and plugin compatibility can change),
// so it is offline-only and always warns before switching.
export default function Versions(props: { onRequestPluginUpdate?: () => void }) {
    const [software, setSoftware] = createSignal<ServerSoftwareType>("paper");
    const [selectedVersion, setSelectedVersion] = createSignal("");
    const [installedSoftware, setInstalledSoftware] =
        createSignal<ServerSoftwareType>("paper");
    const [installedVersion, setInstalledVersion] = createSignal("");
    const [switching, setSwitching] = createSignal(false);
    const [error, setError] = createSignal("");
    const [postSwitchOpen, setPostSwitchOpen] = createSignal(false);
    const [postSwitchCount, setPostSwitchCount] = createSignal(0);
    const [uninstallingAll, setUninstallingAll] = createSignal(false);
    const [confirmSwitchOpen, setConfirmSwitchOpen] = createSignal(false);
    // blocking install modal: no onClose, so no dismiss path exists while
    // the switch runs. A footer Dismiss appears only on failure.
    const [installOpen, setInstallOpen] = createSignal(false);
    const [installFailed, setInstallFailed] = createSignal(false);
    const [javaDownloadPercent, setJavaDownloadPercent] = createSignal(0);
    const [javaDownloadStatus, setJavaDownloadStatus] =
        createSignal<LoaderStatus>("waiting");
    const [javaExtractPercent, setJavaExtractPercent] = createSignal(0);
    const [javaExtractStatus, setJavaExtractStatus] =
        createSignal<LoaderStatus>("waiting");
    const [softwarePercent, setSoftwarePercent] = createSignal(0);
    const [softwareStatus, setSoftwareStatus] = createSignal<LoaderStatus>("waiting");

    const online = () => serverStatus() !== "offline";

    // The jar download runs inside the service action, which publishes
    // throttled progress through service state; map it onto the row while
    // this modal owns the switch. Terminal states stay with the call below.
    createEffect(() => {
        if (!installOpen() || installFailed()) return;
        const progress = installProgress();
        if (!progress) return;
        if (progress.stage === "completed") {
            setSoftwarePercent(100);
            setSoftwareStatus("success");
        } else if (progress.stage === "error") {
            setSoftwarePercent(0);
            setSoftwareStatus("error");
        } else {
            setSoftwarePercent(progress.percent);
            setSoftwareStatus("loading");
        }
    });

    onMount(async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.software) {
                setInstalledSoftware(saved.software);
                setSoftware(saved.software);
            }
            if (saved?.version) {
                setInstalledVersion(saved.version);
                setSelectedVersion(saved.version);
            }
        } catch (err) {
            console.debug("[Versions] saved config unreadable:", String(err));
        }
    });

    const canSwitch = () =>
        !switching() &&
        !online() &&
        Boolean(selectedVersion()) &&
        (software() !== installedSoftware() || selectedVersion() !== installedVersion());

    const switchVersion = async () => {
        setError("");
        if (online()) {
            setError("Stop the server before switching versions.");
            return;
        }
        // The service installs Java as part of the switch, but the rows need
        // a truthful starting state: an already-present runtime shows success
        // immediately, a missing one shows loading. The service call emits no
        // staged progress, so the loaders are coarse by design.
        const javaPkg = getRequiredJavaVersion(selectedVersion());
        if (!javaPkg) {
            setError(`Could not determine the Java runtime for ${selectedVersion()}.`);
            return;
        }
        setJavaDownloadPercent(0);
        setJavaDownloadStatus("loading");
        setJavaExtractPercent(0);
        setJavaExtractStatus("waiting");
        setSoftwarePercent(0);
        setSoftwareStatus("waiting");
        setInstallFailed(false);
        // clear any previous switch's terminal state before the modal reads
        // the signal; the service resets it again when its download starts
        setInstallProgress(null);
        setInstallOpen(true);
        setSwitching(true);
        try {
            // count the OLD software's jars before the switch changes which
            // folder is active — that is what the uninstall prompt is about
            const previousCount = await listInstalledPlugins()
                .then((r) => r.plugins.length)
                .catch(() => 0);

            // Java installs here with real staged progress, exactly like
            // onboarding. The service call below re-checks and skips it, so
            // there is no double download — it still owns the jar, the
            // checksum, and the state sync.
            await ensureJavaRuntime(javaPkg, {
                onDownload: (percent) => {
                    setJavaDownloadStatus("loading");
                    setJavaDownloadPercent(percent);
                },
                onExtract: (percent) => {
                    setJavaDownloadStatus("success");
                    setJavaDownloadPercent(100);
                    setJavaExtractStatus("loading");
                    setJavaExtractPercent(percent);
                },
            });
            setJavaDownloadPercent(100);
            setJavaDownloadStatus("success");
            setJavaExtractPercent(100);
            setJavaExtractStatus("success");

            setSoftwareStatus("loading");
            await serverBridge.call(ACTION_IDS.installServerVersion, {
                software: software(),
                version: selectedVersion(),
            });

            setSoftwarePercent(100);
            setSoftwareStatus("success");
            setInstalledSoftware(software());
            setInstalledVersion(selectedVersion());
            setPostSwitchCount(previousCount);
            setInstallOpen(false);
            setPostSwitchOpen(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Versions] Failed to switch version:", err);
            setError(message);
            if (softwareStatus() === "loading") {
                setSoftwarePercent(0);
                setSoftwareStatus("error");
            } else if (javaExtractStatus() === "loading") {
                setJavaExtractPercent(0);
                setJavaExtractStatus("error");
            } else {
                setJavaDownloadPercent(0);
                setJavaDownloadStatus("error");
            }
            setInstallFailed(true);
        } finally {
            setSwitching(false);
        }
    };

    const uninstallAll = async () => {
        setUninstallingAll(true);
        try {
            await uninstallAllPlugins();
            setPostSwitchCount(0);
            setPostSwitchOpen(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Versions] Failed to uninstall plugins:", err);
            setError(message);
        } finally {
            setUninstallingAll(false);
        }
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight style={{ "min-height": 0 }}>
            <div class="gs-scroll">
                <div class="gs-page">
                    <PaperPageHeader icon="deployed_code" title="Versions" />

                    <Show when={error()}>
                        <PaperQuote variant="red" icon="warning" title="Error">
                            {error()}
                        </PaperQuote>
                    </Show>

                    <div class="gs-surface">
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={3} weight={700}>
                                Server software
                            </PaperText>
                            <PaperSelector
                                horizontal
                                name="serverSoftware"
                                value={software()}
                                onValueChange={(val) => {
                                    setSoftware(val as ServerSoftwareType);
                                    setSelectedVersion("");
                                }}
                            >
                                <PaperSelectorItem value="vanilla">
                                    Vanilla
                                </PaperSelectorItem>
                                <PaperSelectorItem value="paper">
                                    Paper
                                </PaperSelectorItem>
                                <PaperSelectorItem value="fabric">
                                    Fabric
                                </PaperSelectorItem>
                            </PaperSelector>
                        </PaperFlex>
                    </div>

                    <div class="gs-surface">
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperFlex
                                direction="row"
                                justify="space-between"
                                align="center"
                                fullWidth
                            >
                                <PaperText size={3} weight={700}>
                                    Minecraft version
                                </PaperText>
                                <PaperText size={2} color="light-text">
                                    Installed:{" "}
                                    {installedVersion()
                                        ? `${SOFTWARE_NAMES[installedSoftware()]} ${installedVersion()}`
                                        : "none"}
                                </PaperText>
                            </PaperFlex>
                            <VersionPicker
                                software={software()}
                                selectedVersion={selectedVersion()}
                                onSelectVersion={setSelectedVersion}
                            />
                        </PaperFlex>
                    </div>

                    <PaperFlex direction="row" justify="flex-end" fullWidth>
                        <PaperButton
                            compact
                            variant="green"
                            disabled={!canSwitch()}
                            onClick={() => setConfirmSwitchOpen(true)}
                        >
                            <PaperIcon>swap_vert</PaperIcon>
                            {switching()
                                ? "Switching…"
                                : `Switch to ${SOFTWARE_NAMES[software()]} ${selectedVersion() || ""}`}
                        </PaperButton>
                    </PaperFlex>
                </div>
            </div>

            <PaperModal
                open={confirmSwitchOpen()}
                onClose={() => setConfirmSwitchOpen(false)}
                title="Switch version?"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setConfirmSwitchOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="red"
                            onClick={() => {
                                setConfirmSwitchOpen(false);
                                void switchVersion();
                            }}
                        >
                            Switch anyway
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        This replaces the server jar with{" "}
                        {SOFTWARE_NAMES[software()]} {selectedVersion()}.
                    </PaperText>
                    <PaperQuote variant="yellow" icon="warning" title="Heads up">
                        Worlds and plugins may not survive every update. Success
                        varies by version, and there is no undo. Back up your world
                        first.
                    </PaperQuote>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={installOpen()}
                size="medium"
                noHeader
                closeOnBackdropClick={false}
                closeOnEsc={false}
                footer={
                    installFailed() ? (
                        <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                            <PaperButton
                                compact
                                onClick={() => {
                                    setInstallOpen(false);
                                    setInstallFailed(false);
                                }}
                            >
                                Dismiss
                            </PaperButton>
                        </PaperFlex>
                    ) : undefined
                }
            >
                <PaperFlex fullWidth center>
                    <div style={{ width: "100%", "max-width": "24rem" }}>
                        <InstallLoaders
                            items={[
                                {
                                    label: "Downloading Java...",
                                    percent: javaDownloadPercent,
                                    status: javaDownloadStatus,
                                },
                                {
                                    label: "Installing Java...",
                                    percent: javaExtractPercent,
                                    status: javaExtractStatus,
                                },
                                {
                                    label: `Downloading ${SOFTWARE_NAMES[software()]}...`,
                                    percent: softwarePercent,
                                    status: softwareStatus,
                                },
                            ]}
                        />
                        <Show when={installFailed() && error()}>
                            <PaperQuote variant="red" icon="warning" title="Switch failed">
                                {error()}
                            </PaperQuote>
                        </Show>
                    </div>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={postSwitchOpen()}
                onClose={() => setPostSwitchOpen(false)}
                title="Version switched"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <Show when={software() !== "vanilla"}>
                            <PaperButton
                                compact
                                onClick={() => {
                                    setPostSwitchOpen(false);
                                    props.onRequestPluginUpdate?.();
                                }}
                            >
                                Check for updates
                            </PaperButton>
                        </Show>
                        <Show when={postSwitchCount() > 0}>
                            <PaperButton
                                compact
                                variant="red"
                                disabled={uninstallingAll()}
                                onClick={() => void uninstallAll()}
                            >
                                {uninstallingAll() ? "Removing…" : "Uninstall all"}
                            </PaperButton>
                        </Show>
                        <PaperButton compact onClick={() => setPostSwitchOpen(false)}>
                            Done
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        {software() === "vanilla"
                            ? "Vanilla has no plugin system. Plugins don't exist until you switch back to Paper."
                            : `${SOFTWARE_NAMES[software()]} ${selectedVersion()} is installed.`}
                    </PaperText>
                    <Show when={postSwitchCount() > 0}>
                        <PaperQuote variant="yellow" icon="warning" title="Existing jars">
                            {postSwitchCount()} plugin/mod jar
                            {postSwitchCount() === 1 ? "" : "s"} from the previous
                            software won't load here. Uninstall them?
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
    );
}
