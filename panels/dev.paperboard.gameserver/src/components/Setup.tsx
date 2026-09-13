import { PANEL_ID } from "../service/types";
import { createSignal, createEffect, Show } from "solid-js";
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
    PaperLoader,
    PaperLoaderGroup,
    PaperModal,
    PaperLink,
    PaperQuote,
    useWizard,
    type LoaderStatus,
} from "@paperboard-dev/paperui";
import {
    fileApi,
    packageApi,
    type PackageProgress,
} from "@paperboard-dev/paperapi";
import {
    getSoftwareDownload,
    getRequiredJavaVersion,
    SOFTWARE_NAMES,
    type ServerSoftwareType,
} from "../lib/software";
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

    const [javaDownloadPercent, setJavaDownloadPercent] = createSignal(0);
    const [javaDownloadStatus, setJavaDownloadStatus] = createSignal<LoaderStatus>("loading");
    const [javaExtractPercent, setJavaExtractPercent] = createSignal(0);
    const [javaExtractStatus, setJavaExtractStatus] = createSignal<LoaderStatus>("waiting");
    const [softwarePercent, setSoftwarePercent] = createSignal(0);
    const [softwareStatus, setSoftwareStatus] = createSignal<LoaderStatus>("waiting");
    const [setupPercent, setSetupPercent] = createSignal(0);
    const [setupStatus, setSetupStatus] = createSignal<LoaderStatus>("waiting");
    const [showEulaModal, setShowEulaModal] = createSignal(false);
    const [declineNotice, setDeclineNotice] = createSignal("");

    let started = false;

    const startInstallation = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);

        const javaPkg = getRequiredJavaVersion(props.version);
        if (!javaPkg) {
            throw new Error(
                `Could not determine the Minecraft version (got ${JSON.stringify(props.version)}) — pick a version before installing.`,
            );
        }

        try {
            const alreadyInstalled = await packageApi.isInstalled(javaPkg);
            if (alreadyInstalled) {
                setJavaDownloadPercent(100);
                setJavaDownloadStatus("success");
                setJavaExtractPercent(100);
                setJavaExtractStatus("success");
            } else {
                await packageApi.download(javaPkg, (progress: PackageProgress) => {
                    if (progress.stage === "downloading") {
                        setJavaDownloadStatus("loading");
                        setJavaDownloadPercent(progress.percent);
                    } else if (progress.stage === "extracting") {
                        setJavaDownloadStatus("success");
                        setJavaDownloadPercent(100);
                        setJavaExtractStatus("loading");
                        setJavaExtractPercent(progress.percent);
                    } else if (progress.stage === "completed") {
                        setJavaDownloadStatus("success");
                        setJavaExtractStatus("success");
                        setJavaExtractPercent(100);
                    }
                });
                setJavaDownloadStatus("success");
                setJavaDownloadPercent(100);
                setJavaExtractStatus("success");
                setJavaExtractPercent(100);
            }
        } catch (err) {
            console.error("[InstallStep] Java installation error:", err);
            setJavaExtractStatus("error");
            wizard?.setOptionsShown(true);
            return;
        }

        try {
            setSoftwareStatus("loading");
            setSoftwarePercent(0);

            const downloadInfo = await getSoftwareDownload(props.software, props.version);
            await fileApi.download({
                url: downloadInfo.url,
                targetPath: "server.jar",
                appId: PANEL_ID,
                sha1: downloadInfo.sha1,
                sha256: downloadInfo.sha256,
                onProgress: (p) => {
                    if (p.stage === "downloading") {
                        setSoftwareStatus("loading");
                        setSoftwarePercent(p.percent);
                    } else if (p.stage === "completed") {
                        setSoftwareStatus("success");
                        setSoftwarePercent(100);
                    }
                },
            });

            setSoftwareStatus("success");
            setSoftwarePercent(100);
        } catch (err) {
            console.error("[InstallStep] Server software download error:", err);
            setSoftwareStatus("error");
            wizard?.setOptionsShown(true);
            return;
        }

        try {
            const eulaContent = await fileApi.read("eula.txt", PANEL_ID).catch(() => "");
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
            wizard?.setOptionsShown(true);
        }
    };

    const handleAgreeEula = async () => {
        try {
            await fileApi.write(
                "eula.txt",
                "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n",
                PANEL_ID,
            );
            setShowEulaModal(false);
            setSetupPercent(100);
            setSetupStatus("success");
            wizard?.setOptionsShown(true);
            wizard?.setCanProceed(true);
        } catch (err) {
            console.error("[InstallStep] Failed to write eula.txt:", err);
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
            "EULA declined — the downloaded files stay in place. The server cannot start until the EULA is accepted; you can accept it any time by running setup again or agreeing when the server prompts.",
        );

        setJavaDownloadPercent(0);
        setJavaDownloadStatus("loading");
        setJavaExtractPercent(0);
        setJavaExtractStatus("waiting");
        setSoftwarePercent(0);
        setSoftwareStatus("waiting");
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

    const softwareName = () => SOFTWARE_NAMES[props.software] || "Server Software";

    return (
        <>
        <PaperCenteredInterface>
            <PaperFlex direction="column" gap="full" center fullWidth>
                <Show when={declineNotice()}>
                    <PaperQuote variant="yellow" icon="info" title="Setup cancelled">
                        {declineNotice()}
                    </PaperQuote>
                </Show>
                <PaperLoaderGroup>
                        <PaperLoader
                            percent={javaDownloadPercent()}
                            loaderStatus={javaDownloadStatus()}
                            label="Downloading Java..."
                        />
                        <PaperLoader
                            percent={javaExtractPercent()}
                            loaderStatus={javaExtractStatus()}
                            label="Installing Java..."
                        />
                        <PaperLoader
                            percent={softwarePercent()}
                            loaderStatus={softwareStatus()}
                            label={`Downloading ${softwareName()}...`}
                        />
                        <PaperLoader
                            percent={setupPercent()}
                            loaderStatus={setupStatus()}
                            label="Setting up server..."
                        />
                    </PaperLoaderGroup>
                </PaperFlex>
            </PaperCenteredInterface>
            <PaperModal
                open={showEulaModal()}
                onClose={handleDeclineEula}
                title="Minecraft End User License Agreement"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={handleDeclineEula} compact variant="text">
                            Decline
                        </PaperButton>
                        <PaperButton onClick={handleAgreeEula} compact>
                            Agree & Continue
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
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

    const handleFinishSetup = async () => {
        try {
            // through the service so panel state (and the sidebar's Mods/Plugins
            // label) is live, not just the config file
            await updatePanelConfig({
                configured: true,
                software: serverSoftware(),
                version: serverVersion(),
            });
            props.onComplete?.();
        } catch (err) {
            console.error("[Setup] Failed to save configuration:", err);
        }
    };

    return (
        <PaperWizard
            showProgress={false}
            hideBack={true}
            finishLabel="Finish Setup"
            finishVariant="green"
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
                            <PaperSelectorItem
                                value="vanilla"
                                icon="deployed_code"
                                description="Official Mojang release. Straight from the source, but suffers from performance issues and has no plugin or mod support."
                            >
                                Vanilla
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="paper"
                                icon={<PaperIcon src="/assets/paper.png" />}
                                description={
                                    <>
                                        <strong>Recommended.</strong> Vast plugin support and high performance, but makes opinionated changes to some game mechanics.
                                    </>
                                }
                            >
                                Paper
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="fabric"
                                icon={<PaperIcon src="/assets/fabric.png" />}
                                description="Limited traditional plugins support, but extensively supports lighter mods. Does not improve performance out of the box."
                            >
                                Fabric
                            </PaperSelectorItem>
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
                <InstallStep software={serverSoftware()} version={serverVersion()} />
            </PaperWizardStep>
        </PaperWizard>
    );
}

export { Setup };
