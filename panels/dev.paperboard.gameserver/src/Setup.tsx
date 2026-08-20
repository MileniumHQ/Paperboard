import { createSignal, createEffect, Show, For } from "solid-js";
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
    PaperContainer,
    PaperLoader,
    PaperLoaderGroup,
    PaperModal,
    PaperLink,
    PaperQuote,
    PaperCheckbox,
    PaperInput,
    PaperList,
    PaperListItem,
    useWizard,
    getVarCss,
    type LoaderStatus,
} from "paperui";
import {
    fileApi,
    config,
    packageApi,
    processApi,
    type PackageProgress,
} from "paperapi";
import {
    getSoftwareDownload,
    getDetailedVersionsForSoftware,
    getRequiredJavaVersion,
    type ServerSoftwareType,
    type VersionItem,
} from "./software";

export const SOFTWARE_NAMES: Record<ServerSoftwareType, string> = {
    vanilla: "Vanilla",
    paper: "Paper",
    fabric: "Fabric",
    neoforge: "NeoForge",
};

export function parseServerSetupOutput(
    chunk: string,
    currentPercent: number,
): number {
    const l = chunk.toLowerCase();
    if (
        l.includes("downloading mojang") ||
        l.includes("downloading vanilla") ||
        l.includes("downloading library") ||
        l.includes("considering library") ||
        l.includes("downloading")
    ) {
        return Math.max(currentPercent, 25);
    }
    if (
        l.includes("unpacking") ||
        l.includes("applying patches") ||
        l.includes("extracting") ||
        l.includes("extract_files") ||
        l.includes("building processors")
    ) {
        return Math.max(currentPercent, 50);
    }
    if (
        l.includes("starting net.minecraft.server.main") ||
        l.includes("starting org.bukkit") ||
        l.includes("starting net.fabricmc") ||
        l.includes("fabric loader") ||
        l.includes("process_minecraft_jar") ||
        l.includes("fancymodloader") ||
        l.includes("[bootstrap]") ||
        l.includes("loading libraries")
    ) {
        return Math.max(currentPercent, 70);
    }
    if (
        l.includes("initializing plugins") ||
        l.includes("initialising converters") ||
        l.includes("loading paper") ||
        l.includes("spongepowered mixin") ||
        (l.includes("loading") && l.includes("mods")) ||
        l.includes("servermain") ||
        l.includes("loading fml") ||
        l.includes("the server installed successfully")
    ) {
        return Math.max(currentPercent, 85);
    }
    if (
        l.includes("eula") ||
        l.includes("agree to the eula") ||
        l.includes("failed to load eula.txt")
    ) {
        return 90;
    }
    return currentPercent;
}

interface VersionStepProps {
    software: ServerSoftwareType;
    selectedVersion: string;
    onSelectVersion: (version: string) => void;
}

function VersionStep(props: VersionStepProps) {
    const wizard = useWizard();
    const [searchQuery, setSearchQuery] = createSignal("");
    const [allVersions, setAllVersions] = createSignal<VersionItem[]>([]);
    const [loading, setLoading] = createSignal(true);

    const [includeReleases, setIncludeReleases] = createSignal(true);
    const [includeSnapshots, setIncludeSnapshots] = createSignal(false);
    const [includeBetas, setIncludeBetas] = createSignal(false);
    const [includeAlphas, setIncludeAlphas] = createSignal(false);

    const loadVersions = async () => {
        setLoading(true);
        try {
            const versions = await getDetailedVersionsForSoftware(
                props.software,
            );
            setAllVersions(versions);
            if (versions.length > 0) {
                const currentExists = versions.some(
                    (v) => v.id === props.selectedVersion,
                );
                if (!currentExists) {
                    const firstRelease =
                        versions.find((v) => v.type === "release") ||
                        versions[0];
                    if (firstRelease) {
                        props.onSelectVersion(firstRelease.id);
                    }
                }
            }
        } catch (err) {
            console.error("[VersionStep] Failed to load versions:", err);
        } finally {
            setLoading(false);
        }
    };

    createEffect(() => {
        if (props.software) {
            loadVersions();
        }
    });

    const filteredVersions = () => {
        const query = searchQuery().toLowerCase().trim();
        const rel = includeReleases();
        const snap = includeSnapshots();
        const beta = includeBetas();
        const alpha = includeAlphas();

        return allVersions().filter((item) => {
            if (item.type === "release" && !rel) return false;
            if (item.type === "snapshot" && !snap) return false;
            if ((item.type === "old_beta" || item.type === "beta") && !beta)
                return false;
            if (item.type === "old_alpha" && !alpha) return false;

            if (query && !item.id.toLowerCase().includes(query)) return false;

            return true;
        });
    };

    return (
        <PaperCenteredInterface size="large">
            <PaperFlex direction="column" gap="full" fullWidth fullHeight>
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="title">Choose Version</PaperText>
                    <PaperText preset="body">
                        Select a Minecraft version for your{" "}
                        {SOFTWARE_NAMES[props.software]} server.
                    </PaperText>
                </PaperFlex>

                <PaperFlex
                    direction="row"
                    gap="full"
                    align="stretch"
                    fullWidth
                    style={{ flex: 1, "min-height": 0 }}
                >
                    <PaperFlex
                        direction="column"
                        gap="half"
                        fullWidth
                        style={{ flex: 1, "min-width": 0, "min-height": 0 }}
                    >
                        <PaperInput
                            fullWidth
                            icon="search"
                            placeholder="Search versions..."
                            value={searchQuery()}
                            onInput={(e) =>
                                setSearchQuery(e.currentTarget.value)
                            }
                        />

                        <PaperContainer
                            style={{
                                flex: 1,
                                "min-height": 0,
                                "overflow-y": "auto",
                            }}
                        >
                            <Show
                                when={!loading()}
                                fallback={
                                    <PaperFlex padding="full" center>
                                        <PaperText
                                            preset="body"
                                            color={getVarCss("light-text")}
                                        >
                                            Loading versions...
                                        </PaperText>
                                    </PaperFlex>
                                }
                            >
                                <Show
                                    when={filteredVersions().length > 0}
                                    fallback={
                                        <PaperFlex padding="full" center>
                                            <PaperText
                                                preset="body"
                                                color={getVarCss("light-text")}
                                            >
                                                No versions matching your
                                                filters.
                                            </PaperText>
                                        </PaperFlex>
                                    }
                                >
                                    <PaperList
                                        name="minecraftVersion"
                                        value={props.selectedVersion}
                                        onValueChange={(val) =>
                                            props.onSelectVersion(String(val))
                                        }
                                        style={{
                                            width: "100%",
                                            height: "auto",
                                            border: "none",
                                            background: "transparent",
                                        }}
                                    >
                                        <For each={filteredVersions()}>
                                            {(item) => (
                                                <PaperListItem
                                                    value={item.id}
                                                    description={
                                                        item.type &&
                                                        item.type !== "release"
                                                            ? `${item.type.replace("old_", "")}`
                                                            : undefined
                                                    }
                                                >
                                                    {item.id}
                                                </PaperListItem>
                                            )}
                                        </For>
                                    </PaperList>
                                </Show>
                            </Show>
                        </PaperContainer>
                    </PaperFlex>

                    <div
                        style={{
                            "flex-shrink": 0,
                            display: "flex",
                            "flex-direction": "column",
                            "min-height": 0,
                        }}
                    >
                        <PaperContainer
                            style={{
                                height: "100%",
                                "overflow-y": "auto",
                            }}
                        >
                            <PaperFlex
                                direction="column"
                                gap="full"
                                padding="full"
                            >
                                <PaperText preset="title">
                                    Version Types
                                </PaperText>
                                <PaperFlex
                                    direction="column"
                                    gap="threefourths"
                                >
                                    <PaperCheckbox
                                        checked={includeReleases()}
                                        onChange={setIncludeReleases}
                                        label="Releases"
                                        description="Full releases"
                                    />
                                    <PaperCheckbox
                                        checked={includeSnapshots()}
                                        onChange={setIncludeSnapshots}
                                        label="Snapshots"
                                    />
                                    <Show when={props.software === "vanilla"}>
                                        <PaperCheckbox
                                            checked={includeBetas()}
                                            onChange={setIncludeBetas}
                                            label="Beta Versions"
                                        />
                                        <PaperCheckbox
                                            checked={includeAlphas()}
                                            onChange={setIncludeAlphas}
                                            label="Alpha Versions"
                                        />
                                    </Show>
                                    <Show when={props.software === "neoforge"}>
                                        <PaperCheckbox
                                            checked={includeBetas()}
                                            onChange={setIncludeBetas}
                                            label="Beta Builds"
                                        />
                                    </Show>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperContainer>
                    </div>
                </PaperFlex>
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
    const [javaDownloadStatus, setJavaDownloadStatus] =
        createSignal<LoaderStatus>("loading");

    const [javaExtractPercent, setJavaExtractPercent] = createSignal(0);
    const [javaExtractStatus, setJavaExtractStatus] =
        createSignal<LoaderStatus>("waiting");

    const [softwarePercent, setSoftwarePercent] = createSignal(0);
    const [softwareStatus, setSoftwareStatus] =
        createSignal<LoaderStatus>("waiting");

    const [setupPercent, setSetupPercent] = createSignal(0);
    const [setupStatus, setSetupStatus] = createSignal<LoaderStatus>("waiting");

    const [showEulaModal, setShowEulaModal] = createSignal(false);

    let started = false;

    const startInstallation = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);

        const javaPkg = getRequiredJavaVersion(props.version);

        try {
            const alreadyInstalled = await packageApi.isInstalled(javaPkg);
            if (alreadyInstalled) {
                setJavaDownloadPercent(100);
                setJavaDownloadStatus("success");
                setJavaExtractPercent(100);
                setJavaExtractStatus("success");
            } else {
                await packageApi.download(
                    javaPkg,
                    (progress: PackageProgress) => {
                        if (progress.stage === "downloading") {
                            setJavaDownloadStatus("loading");
                            setJavaDownloadPercent(progress.percent);
                            setJavaExtractStatus("waiting");
                        } else if (progress.stage === "verifying") {
                            setJavaDownloadStatus("loading");
                            setJavaDownloadPercent(100);
                            setJavaExtractStatus("waiting");
                        } else if (progress.stage === "extracting") {
                            setJavaDownloadStatus("success");
                            setJavaDownloadPercent(100);
                            setJavaExtractStatus("loading");
                            setJavaExtractPercent(progress.percent);
                        } else if (progress.stage === "completed") {
                            setJavaDownloadStatus("success");
                            setJavaDownloadPercent(100);
                            setJavaExtractStatus("success");
                            setJavaExtractPercent(100);
                        } else if (progress.stage === "error") {
                            setJavaDownloadStatus("error");
                            setJavaExtractStatus("error");
                            throw new Error("Java download failed");
                        }
                    },
                );

                setJavaDownloadStatus("success");
                setJavaDownloadPercent(100);
                setJavaExtractStatus("success");
                setJavaExtractPercent(100);
            }
        } catch (err) {
            console.error("[InstallStep] Java installation error:", err);
            setJavaExtractStatus("error");
            wizard?.setOptionsShown(true);
            wizard?.setCanProceed(false);
            return;
        }

        try {
            setSoftwareStatus("loading");
            setSoftwarePercent(0);

            const downloadInfo = await getSoftwareDownload(
                props.software,
                props.version,
            );

            await fileApi.download({
                url: downloadInfo.url,
                targetPath: "server.jar",
                sha1: downloadInfo.sha1,
                sha256: downloadInfo.sha256,
                onProgress: (p) => {
                    if (p.stage === "downloading") {
                        setSoftwareStatus("loading");
                        setSoftwarePercent(p.percent);
                    } else if (p.stage === "verifying") {
                        setSoftwareStatus("loading");
                        setSoftwarePercent(100);
                    } else if (p.stage === "completed") {
                        setSoftwareStatus("success");
                        setSoftwarePercent(100);
                    } else if (p.stage === "error") {
                        setSoftwareStatus("error");
                    }
                },
            });

            setSoftwareStatus("success");
            setSoftwarePercent(100);
        } catch (err) {
            console.error("[InstallStep] Server software download error:", err);
            setSoftwareStatus("error");
            wizard?.setOptionsShown(true);
            wizard?.setCanProceed(false);
            return;
        }

        try {
            setSetupStatus("loading");
            setSetupPercent(10);

            const javaPkg = getRequiredJavaVersion(props.version);
            const javaPath = await packageApi.getPath(javaPkg);
            const isWin =
                typeof navigator !== "undefined" &&
                navigator.platform?.toLowerCase().includes("win");
            const javaBin = `${javaPath}/bin/${isWin ? "java.exe" : "java"}`;
            const serverDir = await fileApi.getPath("");

            if (props.software === "neoforge") {
                await processApi.run({
                    command: javaBin,
                    args: ["-jar", "server.jar", "--install-server"],
                    cwd: serverDir,
                    onData: (chunk) => {
                        const nextPercent = parseServerSetupOutput(
                            chunk,
                            setupPercent(),
                        );
                        if (nextPercent !== setupPercent()) {
                            setSetupPercent(nextPercent);
                        }
                    },
                });

                await processApi.run({
                    command: isWin ? "cmd.exe" : "bash",
                    args: isWin
                        ? ["/c", "run.bat", "nogui"]
                        : ["run.sh", "nogui"],
                    cwd: serverDir,
                    env: {
                        JAVA_HOME: javaPath,
                    },
                    onData: (chunk) => {
                        const nextPercent = parseServerSetupOutput(
                            chunk,
                            setupPercent(),
                        );
                        if (nextPercent !== setupPercent()) {
                            setSetupPercent(nextPercent);
                        }
                    },
                });
            } else {
                await processApi.run({
                    command: javaBin,
                    args: ["-jar", "server.jar", "nogui"],
                    cwd: serverDir,
                    onData: (chunk) => {
                        const nextPercent = parseServerSetupOutput(
                            chunk,
                            setupPercent(),
                        );
                        if (nextPercent !== setupPercent()) {
                            setSetupPercent(nextPercent);
                        }
                    },
                });
            }

            setSetupPercent(90);
            setShowEulaModal(true);
        } catch (err) {
            console.error("[InstallStep] Server setup error:", err);
            setSetupStatus("error");
            wizard?.setOptionsShown(true);
            wizard?.setCanProceed(false);
        }
    };

    const handleAgreeEula = async () => {
        try {
            await fileApi.write(
                "eula.txt",
                "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n",
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
        try {
            await fileApi.clear();
        } catch (err) {
            console.warn(
                "[InstallStep] Failed to clear files on decline:",
                err,
            );
        }

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

    const softwareName = () =>
        SOFTWARE_NAMES[props.software] || "Server Software";

    return (
        <>
            <PaperCenteredInterface>
                <PaperFlex direction="column" gap="full" center fullWidth>
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
                    <PaperFlex
                        direction="row"
                        justify="flex-end"
                        gap="half"
                        fullWidth
                    >
                        <PaperButton
                            onClick={handleDeclineEula}
                            compact
                            variant="text"
                        >
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
                        To run a Minecraft server, you must review and agree to
                        Mojang's official End User License Agreement (EULA). You
                        can review the complete terms online:
                    </PaperText>
                    <PaperQuote>
                        <PaperLink
                            href="https://aka.ms/MinecraftEULA"
                            target="_blank"
                        >
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
    const [serverVersion, setServerVersion] = createSignal<string>(
        props.initialVersion || "",
    );

    const handleFinishSetup = async () => {
        try {
            await config.set({
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
                        <PaperText preset="body">
                            Choose what game you want to run.
                        </PaperText>
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
                            Pick a server software depending on your needs. You
                            can change this later.
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
                                        <strong>Recommended.</strong> Vast
                                        plugin support and high performance, but
                                        makes opinionated changes to some game
                                        mechanics.
                                    </>
                                }
                            >
                                Paper
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="fabric"
                                icon={<PaperIcon src="/assets/fabric.png" />}
                                description="Limited traditional plugins upport, but extensively supports lighter mods. Does not improve performance out of the box."
                            >
                                Fabric
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="neoforge"
                                icon={<PaperIcon src="/assets/neoforge.png" />}
                                description="Limited traditional plugin support, but required for most larger modpacks and has the best support for heavier mods."
                            >
                                NeoForge
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
                <InstallStep
                    software={serverSoftware()}
                    version={serverVersion()}
                />
            </PaperWizardStep>
        </PaperWizard>
    );
}

export { Setup };
