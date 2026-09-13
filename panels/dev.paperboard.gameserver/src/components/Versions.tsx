import { createSignal, onMount, Show } from "solid-js";
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
} from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";
import { PANEL_ID } from "../service/types";
import { ACTION_IDS } from "../service/contract";
import { serverBridge, serverStatus } from "../lib/server";
import { SOFTWARE_NAMES, type ServerSoftwareType } from "../lib/software";
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

    const online = () => serverStatus() !== "offline";

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
        setSwitching(true);
        try {
            // count the OLD software's jars before the switch changes which
            // folder is active — that is what the uninstall prompt is about
            const previousCount = await listInstalledPlugins()
                .then((r) => r.plugins.length)
                .catch(() => 0);

            // the service owns the download: it enforces offline, installs
            // the required Java runtime, verifies the jar checksum, and
            // updates panel state (so the sidebar reacts)
            await serverBridge.call(ACTION_IDS.installServerVersion, {
                software: software(),
                version: selectedVersion(),
            });

            setInstalledSoftware(software());
            setInstalledVersion(selectedVersion());
            setPostSwitchCount(previousCount);
            setPostSwitchOpen(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Versions] Failed to switch version:", err);
            setError(message);
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
                                <PaperSelectorItem value="vanilla" icon="deployed_code">
                                    Vanilla
                                </PaperSelectorItem>
                                <PaperSelectorItem
                                    value="paper"
                                    icon={<PaperIcon src="/assets/paper.png" />}
                                >
                                    Paper
                                </PaperSelectorItem>
                                <PaperSelectorItem
                                    value="fabric"
                                    icon={<PaperIcon src="/assets/fabric.png" />}
                                >
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
                        Worlds and plugins may not survive every update — success
                        varies by version, and there is no undo. Back up your world
                        first.
                    </PaperQuote>
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
                            ? "Vanilla has no plugin system — plugins don't exist until you switch back to Paper."
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
