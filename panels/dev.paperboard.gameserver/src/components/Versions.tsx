import { createSignal, For, onMount, Show } from "solid-js";
import RecoveryNotice from "./RecoveryNotice";
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
    showError,
} from "@mileniumhq/paperui";
import InstallProgressModal from "./InstallProgressModal";
import { useServer } from "../lib/server";
import { createInstallRun } from "../lib/installRun";
import {
    SOFTWARE,
    SOFTWARE_IDS,
    SOFTWARE_NAMES,
    getRequiredJavaVersion,
    type ServerSoftwareType,
} from "../lib/software";
import { isServerSoftware } from "../software/catalog";
import VersionPicker from "./VersionPicker";
import { errorMessage } from "../lib/failure";

// Versions: swap the server software for a different software/version. This is a
// destructive boundary (world format and plugin compatibility can change),
// so it is offline-only and always warns before switching.
export default function Versions(props: { onRequestPluginUpdate?: () => void }) {
    const { calls, serverStatus } = useServer();
    const [software, setSoftware] = createSignal<ServerSoftwareType>("paper");
    const [selectedVersion, setSelectedVersion] = createSignal("");
    const [installedSoftware, setInstalledSoftware] =
        createSignal<ServerSoftwareType>("paper");
    const [installedVersion, setInstalledVersion] = createSignal("");
    const [switching, setSwitching] = createSignal(false);
    const [postSwitchOpen, setPostSwitchOpen] = createSignal(false);
    const [postSwitchCount, setPostSwitchCount] = createSignal(0);
    const [uninstallingAll, setUninstallingAll] = createSignal(false);
    const [confirmSwitchOpen, setConfirmSwitchOpen] = createSignal(false);
    // blocking install modal: no onClose, so no dismiss path exists while
    // the switch runs. A footer Dismiss appears only once it failed, why.
    const [installOpen, setInstallOpen] = createSignal(false);
    const [installFailure, setInstallFailure] = createSignal("");
    const install = createInstallRun();
    const [postSwitchWarning, setPostSwitchWarning] = createSignal("");

    const online = () => serverStatus() !== "offline";

    onMount(async () => {
        try {
            const saved = await calls.readServerConfig();
            const { software, version } = saved;
            if (isServerSoftware(software)) {
                setInstalledSoftware(software);
                setSoftware(software);
            }
            if (typeof version === "string" && version) {
                setInstalledVersion(version);
                setSelectedVersion(version);
            }
        } catch (err) {
            showError("Couldn't read the installed version", errorMessage(err));
        }
    });

    const canSwitch = () =>
        !switching() &&
        !online() &&
        Boolean(selectedVersion()) &&
        (software() !== installedSoftware() || selectedVersion() !== installedVersion());

    const switchVersion = async () => {
        if (online()) {
            showError("Couldn't switch versions", "Stop the server before switching versions.");
            return;
        }
        if (!getRequiredJavaVersion(selectedVersion())) {
            showError("Couldn't switch versions", `Could not determine the Java runtime for ${selectedVersion()}.`);
            return;
        }
        setInstallFailure("");
        setInstallOpen(true);
        setSwitching(true);
        try {
            // count the OLD software's jars before the switch changes which
            // folder is active — that is what the uninstall prompt is about
            // nothing has changed yet when this fails, so the switch stops here
            const previousCount = await calls.listInstalledPlugins()
                .then((r) => r.plugins.length)
                .catch((err) => { throw new Error(`The installed add-ons could not be counted before switching: ${errorMessage(err)}`); });

            const outcome = await install.run(software(), selectedVersion());

            setInstalledSoftware(software());
            setInstalledVersion(selectedVersion());
            setPostSwitchCount(previousCount);
            setPostSwitchWarning(outcome.warning ?? "");
            setInstallOpen(false);
            setPostSwitchOpen(true);
        } catch (err) {
            setInstallFailure(errorMessage(err));
        } finally {
            setSwitching(false);
        }
    };

    const uninstallAll = async () => {
        setUninstallingAll(true);
        try {
            // trash-first removal of every jar under both plugins/ and mods/, plus the install records
            await calls.uninstallAllPlugins();
            setPostSwitchCount(0);
            setPostSwitchOpen(false);
        } catch (err) {
            showError("Couldn't uninstall the add-ons", errorMessage(err));
        } finally {
            setUninstallingAll(false);
        }
    };

    return (
        <>
                    <PaperPageHeader icon="deployed_code" title="Versions" />

                    <RecoveryNotice />

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
                                wrap
                                gap="onefourth"
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
                    <>
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
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        This replaces the installed server software with{" "}
                        {SOFTWARE_NAMES[software()]} {selectedVersion()}. If the
                        install fails, the current server is kept as it was.
                    </PaperText>
                    <PaperQuote variant="warning" icon="warning" title="Back up first">
                        Worlds and plugins may not survive every update. Success
                        varies by version, and there is no undo. Back up your world
                        first.
                    </PaperQuote>
                </PaperFlex>
            </PaperModal>

            <InstallProgressModal
                open={installOpen()}
                rows={install.rows(software())}
                failure={installFailure() ? { title: "Couldn't switch versions", message: installFailure() } : undefined}
                onDismiss={() => {
                    setInstallOpen(false);
                    setInstallFailure("");
                }}
            />

            <PaperModal
                open={postSwitchOpen()}
                onClose={() => setPostSwitchOpen(false)}
                title="Version switched"
                size="small"
                footer={
                    <>
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
                    </>
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
