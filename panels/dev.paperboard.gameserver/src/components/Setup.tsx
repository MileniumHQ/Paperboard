import { PANEL_ID } from "../service/types";
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import {
    PaperFlex,
    PaperButton,
    PaperIcon,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    PaperCenteredInterface,
    PaperSelector,
    PaperSelectorItem,
    PaperModal,
    PaperLink,
    PaperQuote,
    useWizard,
    type LoaderStatus,
} from "@mileniumhq/paperui";
import InstallLoaders from "./InstallLoaders";
import { fileApi } from "@mileniumhq/paperapi";
import { createInstallRun } from "../lib/installRun";
import {
    SOFTWARE,
    SOFTWARE_IDS,
    SOFTWARE_NAMES,
    type ServerSoftwareType,
} from "../lib/software";
import SoftwareIcon from "./SoftwareIcon";
import VersionPicker from "./VersionPicker";
import { updatePanelConfig } from "../lib/server";

interface VersionStepProps {
    software: ServerSoftwareType;
    selectedVersion: string;
    onSelectVersion: (version: string) => void;
}

function VersionStep(props: VersionStepProps) {
    return (
        <PaperCenteredInterface size="large">
            <PaperFlex direction="column" gap="full" fullWidth fullHeight>
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="title">Choose Version</PaperText>
                    <PaperText preset="body">
                        Select a Minecraft version for your {SOFTWARE_NAMES[props.software]} server.
                    </PaperText>
                </PaperFlex>
                <VersionPicker
                    software={props.software}
                    selectedVersion={props.selectedVersion}
                    onSelectVersion={props.onSelectVersion}
                    fill
                />
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

interface InstallStepProps {
    software: ServerSoftwareType;
    version: string;
}

function InstallStep(props: InstallStepProps) {
    const wizard = useWizard();

    const install = createInstallRun();
    const [setupPercent, setSetupPercent] = createSignal(0);
    const [setupStatus, setSetupStatus] = createSignal<LoaderStatus>("waiting");
    const [showEulaModal, setShowEulaModal] = createSignal(false);
    const [declineNotice, setDeclineNotice] = createSignal("");

    const [error, setError] = createSignal("");
    const [eulaError, setEulaError] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    let started = false;
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const reportFailure = (err: unknown) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        wizard?.setOptionsShown(true);
        wizard?.setCanProceed(false);
    };

    const startInstallation = async () => {
        if (busy() || disposed) return;
        setBusy(true);
        setError("");
        setSetupPercent(0);
        setSetupStatus("waiting");
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);

        try {
            // the service downloads, installs and records the software;
            // the rows follow its published progress
            await install.run(props.software, props.version);
            if (disposed) return;
        } catch (err) {
            console.error("[InstallStep] Server install error:", err);
            reportFailure(err);
            return;
        }

        try {
            const eulaContent = await fileApi.read("eula.txt", PANEL_ID);
            if (disposed) return;
            setBusy(false);
            if (eulaContent && eulaContent.includes("eula=true")) {
                setSetupPercent(100);
                setSetupStatus("success");
                wizard?.setOptionsShown(true);
                wizard?.setCanProceed(true);
                return;
            }

            setSetupStatus("loading");
            setSetupPercent(50);
            setShowEulaModal(true);
        } catch (err) {
            console.error("[InstallStep] Server setup error:", err);
            setSetupStatus("error");
            reportFailure(err);
        }
    };

    const handleAgreeEula = async () => {
        if (busy()) return;
        setBusy(true);
        setEulaError("");
        try {
            await fileApi.write(
                "eula.txt",
                "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n",
                PANEL_ID,
            );
            if (disposed) return;
            setShowEulaModal(false);
            setSetupPercent(100);
            setSetupStatus("success");
            wizard?.setOptionsShown(true);
            wizard?.setCanProceed(true);
        } catch (err) {
            setEulaError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleDeclineEula = async () => {
        setShowEulaModal(false);
        // the EULA decision is honored, not punished: nothing is deleted.
        // (This used to be fileApi.clear(PANEL_ID) — an irreversible wipe
        // of the whole install folder from a single click, the panel's only
        // destructive path that skipped the trash-first discipline. The
        // files do no work until the server starts, and they are exactly
        // what a later accept-and-start reuses.)
        setDeclineNotice(
            "EULA declined. The downloaded files stay in place. The server cannot start until the EULA is accepted; you can accept it any time by running setup again or agreeing when the server prompts.",
        );

        setSetupPercent(0);
        setSetupStatus("waiting");
        started = false;

        wizard?.setOptionsShown(true);
        wizard?.setCanProceed(true);
        wizard?.setCurrentStep(0);
    };

    createEffect(() => {
        if (wizard?.currentStep() === 3 && !started) {
            started = true;
            startInstallation();
        }
    });

    return (
        <>
        <PaperCenteredInterface>
            <PaperFlex direction="column" gap="full" center fullWidth>
                <Show when={declineNotice()}>
                    <PaperQuote variant="warning" icon="info" title="Setup cancelled">
                        {declineNotice()}
                    </PaperQuote>
                </Show>
                <Show when={error()}>
                    <PaperQuote variant="danger" title="Setup failed">{error()}</PaperQuote>
                    <PaperFlex gap="half">
                        <PaperButton onClick={() => void startInstallation()}>Retry setup</PaperButton>
                        <PaperButton onClick={() => wizard?.setCurrentStep(1)}>Change software or version</PaperButton>
                    </PaperFlex>
                </Show>
                <InstallLoaders
                    items={[
                        ...install.rows(props.software),
                        {
                            label: "Setting up server...",
                            percent: setupPercent,
                            status: setupStatus,
                        },
                    ]}
                />
                </PaperFlex>
            </PaperCenteredInterface>
            <PaperModal
                open={showEulaModal()}
                onClose={() => { if (!busy()) void handleDeclineEula(); }}
                title="Minecraft End User License Agreement"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton disabled={busy()} onClick={handleDeclineEula} variant="text">
                            Decline
                        </PaperButton>
                        <PaperButton disabled={busy()} onClick={handleAgreeEula}>
                            Agree & Continue
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <Show when={eulaError()}>
                        <PaperQuote variant="danger" title="Could not save EULA agreement">{eulaError()}</PaperQuote>
                    </Show>
                    <PaperText preset="body">
                        To run a Minecraft server, you must review and agree to Mojang's official End User License Agreement (EULA).
                    </PaperText>
                    <PaperQuote>
                        <PaperLink href="https://aka.ms/MinecraftEULA" target="_blank">
                            https://aka.ms/MinecraftEULA
                        </PaperLink>
                    </PaperQuote>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

export interface SetupProps {
    onComplete?: () => void;
    initialSoftware?: ServerSoftwareType;
    initialVersion?: string;
}

export default function Setup(props: SetupProps) {
    const [serverSoftware, setServerSoftware] =
        createSignal<ServerSoftwareType>(props.initialSoftware || "paper");
    const [serverVersion, setServerVersion] = createSignal<string>(props.initialVersion || "");

    const [saveError, setSaveError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const handleFinishSetup = async () => {
        if (saving()) return;
        setSaving(true);
        setSaveError("");
        try {
            // the install step already recorded software and version; this
            // marks onboarding done, through the service so panel state is live
            await updatePanelConfig({ configured: true });
            props.onComplete?.();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperWizard
            showProgress={false}
            hideBack={true}
            finishLabel={saving() ? "Saving…" : "Finish Setup"}
            finishVariant="success"
            onComplete={handleFinishSetup}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface>
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Select Game</PaperText>
                        <PaperText preset="body">Choose what game you want to run.</PaperText>
                        <PaperSelector name="gameType" value="minecraftJava">
                            <PaperSelectorItem value="minecraftJava">
                                Minecraft: Java Edition
                            </PaperSelectorItem>
                            <PaperSelectorItem value="othergames" disabled>
                                <em>Other games coming soon&trade;</em>
                            </PaperSelectorItem>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1}>
                <PaperCenteredInterface size="large">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Server Software</PaperText>
                        <PaperText preset="body">
                            Pick a server software depending on your needs. You can change this later.
                        </PaperText>
                        <PaperSelector
                            name="serverSoftware"
                            value={serverSoftware()}
                            onValueChange={(val) => {
                                setServerSoftware(val as ServerSoftwareType);
                                setServerVersion("");
                            }}
                        >
                            <For each={SOFTWARE_IDS}>
                                {(id) => (
                                    <PaperSelectorItem
                                        value={id}
                                        icon={<SoftwareIcon software={id} />}
                                        description={
                                            SOFTWARE[id].recommended ? (
                                                <>
                                                    <strong>Recommended.</strong> {SOFTWARE[id].description}
                                                </>
                                            ) : (
                                                SOFTWARE[id].description
                                            )
                                        }
                                    >
                                        {SOFTWARE[id].name}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={2} canProceed={Boolean(serverVersion())}>
                <VersionStep
                    software={serverSoftware()}
                    selectedVersion={serverVersion()}
                    onSelectVersion={setServerVersion}
                />
            </PaperWizardStep>

            <PaperWizardStep index={3}>
                <Show when={saveError()}>
                    <PaperQuote variant="danger" title="Could not finish setup">{saveError()} Try Finish Setup again.</PaperQuote>
                </Show>
                <InstallStep software={serverSoftware()} version={serverVersion()} />
            </PaperWizardStep>
        </PaperWizard>
    );
}

export { Setup };
