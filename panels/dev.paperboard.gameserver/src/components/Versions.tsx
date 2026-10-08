import { createSignal, For, onMount, Show } from "solid-js";
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
    PaperCard,
    getVarCss,
} from "@mileniumhq/paperui";
import { config } from "@mileniumhq/paperapi";
import InstallLoaders from "./InstallLoaders";
import { PANEL_ID } from "../service/types";
import { serverStatus } from "../lib/server";
import { createInstallRun } from "../lib/installRun";
import {
    SOFTWARE,
    SOFTWARE_IDS,
    SOFTWARE_NAMES,
    getRequiredJavaVersion,
    type ServerSoftwareType,
} from "../lib/software";
import { isServerSoftware } from "../software/catalog";
import { listInstalledPlugins, uninstallAllPlugins } from "../lib/plugins";
import VersionPicker from "./VersionPicker";

// Versions: swap the server software for a different software/version. This is a
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
    const install = createInstallRun();
    const [postSwitchWarning, setPostSwitchWarning] = createSignal("");

    const online = () => serverStatus() !== "offline";

    onMount(async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (isServerSoftware(saved?.software)) {
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
        if (!getRequiredJavaVersion(selectedVersion())) {
            setError(`Could not determine the Java runtime for ${selectedVersion()}.`);
            return;
        }
        setInstallFailed(false);
        setInstallOpen(true);
        setSwitching(true);
        try {
            // count the OLD software's jars before the switch changes which
            // folder is active — that is what the uninstall prompt is about
            const previousCount = await listInstalledPlugins()
                .then((r) => r.plugins.length)
                .catch(() => 0);

            const outcome = await install.run(software(), selectedVersion());

            setInstalledSoftware(software());
            setInstalledVersion(selectedVersion());
            setPostSwitchCount(previousCount);
            setPostSwitchWarning(outcome.warning ?? "");
            setInstallOpen(false);
            setPostSwitchOpen(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Versions] Failed to switch version:", err);
            setError(message);
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
        <>
                    <PaperPageHeader icon="deployed_code" title="Versions" />

                    <Show when={error()}>
                        <PaperQuote variant="danger" icon="warning" title="Error">
                            {error()}
                        </PaperQuote>
                    </Show>

                    <PaperCard>
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
                                <For each={SOFTWARE_IDS}>
                                    {(id) => (
                                        <PaperSelectorItem value={id}>
                                            {SOFTWARE[id].name}
                                        </PaperSelectorItem>
                                    )}
                                </For>
                            </PaperSelector>
                        </PaperFlex>
                    </PaperCard>

                    <PaperCard>
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
                                <PaperText size={2} color="text-subtle">
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
                    </PaperCard>

                    <PaperFlex direction="row" justify="flex-end" fullWidth>
                        <PaperButton
                            variant="success"
                            disabled={!canSwitch()}
                            onClick={() => setConfirmSwitchOpen(true)}>
                            <PaperIcon>swap_vert</PaperIcon>
                            {switching()
                                ? "Switching…"
                                : `Switch to ${SOFTWARE_NAMES[software()]} ${selectedVersion() || ""}`}
                        </PaperButton>
                    </PaperFlex>

            <PaperModal
                open={confirmSwitchOpen()}
                onClose={() => setConfirmSwitchOpen(false)}
                title="Switch version?"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setConfirmSwitchOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={() => {
                                setConfirmSwitchOpen(false);
                                void switchVersion();
                            }}>
                            Switch anyway
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        This replaces the installed server software with{" "}
                        {SOFTWARE_NAMES[software()]} {selectedVersion()}. If the
                        install fails, the current server is kept as it was.
                    </PaperText>
                    <PaperQuote variant="warning" icon="warning" title="Heads up">
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
                                onClick={() => {
                                    setInstallOpen(false);
                                    setInstallFailed(false);
                                }}>
                                Dismiss
                            </PaperButton>
                        </PaperFlex>
                    ) : undefined
                }
            >
                <PaperFlex fullWidth center>
                    <PaperFlex fullWidth maxWidth={getVarCss("size-panel-small")}>
                        <InstallLoaders items={install.rows(software())} />
                        <Show when={installFailed() && error()}>
                            <PaperQuote variant="danger" icon="warning" title="Switch failed">
                                {error()}
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={postSwitchOpen()}
                onClose={() => setPostSwitchOpen(false)}
                title="Version switched"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <Show when={SOFTWARE[software()].addons}>
                            <PaperButton
                                onClick={() => {
                                    setPostSwitchOpen(false);
                                    props.onRequestPluginUpdate?.();
                                }}>
                                Update {SOFTWARE[software()].addons?.kind === "mod" ? "mods" : "plugins"}
                            </PaperButton>
                        </Show>
                        <Show when={postSwitchCount() > 0}>
                            <PaperButton
                                variant="danger"
                                disabled={uninstallingAll()}
                                onClick={() => void uninstallAll()}>
                                {uninstallingAll() ? "Removing…" : "Uninstall all"}
                            </PaperButton>
                        </Show>
                        <PaperButton onClick={() => setPostSwitchOpen(false)}>
                            Done
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        {SOFTWARE[software()].addons
                            ? `${SOFTWARE_NAMES[software()]} ${selectedVersion()} is installed.`
                            : `${SOFTWARE_NAMES[software()]} has no plugin or mod system. Existing plugins and mods stay on disk unused.`}
                    </PaperText>
                    <Show when={postSwitchWarning()}>
                        <PaperQuote variant="warning" icon="warning" title="Cleanup incomplete">
                            {postSwitchWarning()}
                        </PaperQuote>
                    </Show>
                    <Show when={postSwitchCount() > 0}>
                        <PaperQuote variant="warning" icon="warning" title="Existing jars">
                            {postSwitchCount()} plugin/mod jar
                            {postSwitchCount() === 1 ? "" : "s"} from the previous
                            software won't load here. Uninstall them?
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
