import { createEffect, createSignal, For, Show, on } from "solid-js";
import {
    createRead,
    PaperButton,
    PaperCenteredInterface,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import { UnsupportedHost, type HostSupport } from "../../components/InstallNotices";
import { errorMessage } from "../../lib/failure";
import { createTerrariaInstall } from "./installRows";
import ReleaseSelector, { releasesOf } from "./ReleaseSelector";
import { releases, SOFTWARE, SOFTWARE_ICON, softwareName, type TerrariaSoftware } from "./catalog";
import { useServer } from "../../lib/server";

/** what each software is, as the setup and Versions selectors describe it */
export const SOFTWARE_DESCRIPTION: Record<TerrariaSoftware, string> = {
    vanilla: "The official dedicated server from terraria.org.",
    tmodloader: "Mods from the Steam Workshop. Everyone who joins plays with tModLoader too.",
};

function InstallStep(props: { software: TerrariaSoftware; version: string }) {
    const install = createTerrariaInstall();
    const { run, wizard } = createWizardInstall(() => install.run(props.software, props.version));
    let started = false;

    // the install starts as its step opens
    createEffect(
        on(
            () => wizard?.currentStep(),
            (step) => {
                if (step === 2 && !started) {
                    started = true;
                    void run();
                }
            },
        ),
    );

    return (
        <InstallStepView
            rows={install.rows(props.software, props.version)}
            error={install.error()}
            onRetry={() => void run()}
            actions={<PaperButton onClick={() => { started = false; install.reset(); wizard?.setCurrentStep(1); }}>Change version</PaperButton>}
        />
    );
}

export default function TerrariaSetup(props: { onComplete(): void }) {
    const [software, setSoftware] = createSignal<TerrariaSoftware>("vanilla");
    const [version, setVersion] = createSignal<string>(releases[0].version);
    const { calls } = useServer();
    // what this computer runs: Next waits for it
    const releasesRead = createRead(async (): Promise<Record<TerrariaSoftware, HostSupport>> => (await calls.terrariaVersions()).hosts, {
        message: errorMessage,
        failure: { title: "Couldn't load the Terraria releases" },
    });
    const support = () => releasesRead.value()?.[software()] ?? null;

    return (
        <PaperWizard
            showProgress={false}
            hideBack={true}
            finishLabel="Finish Setup"
            finishVariant="success"
            onComplete={props.onComplete}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface size="large" height="100%">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Server Software</PaperText>
                        <PaperText preset="body">
                            Pick vanilla Terraria, or tModLoader to play with mods. A server keeps the software it is made with.
                        </PaperText>
                        <PaperSelector
                            name="terrariaSoftware"
                            value={software()}
                            onValueChange={(value) => {
                                const next = value as TerrariaSoftware;
                                setSoftware(next);
                                setVersion(releasesOf(next)[0]!.version);
                            }}
                        >
                            <For each={SOFTWARE}>
                                {(id) => (
                                    <PaperSelectorItem value={id} description={SOFTWARE_DESCRIPTION[id]} icon={<PaperIcon src={SOFTWARE_ICON[id]} />}>
                                        {softwareName(id)}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={support()?.supported === true}>
                <PaperCenteredInterface size="large" height="100%">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Choose Version</PaperText>
                        <PaperText preset="body">
                            Select a release for your {software() === "tmodloader" ? "tModLoader" : "Terraria"} dedicated server. A world is created on the first start; to choose its size, difficulty and seed, make one in Worlds first.
                        </PaperText>
                        <Show when={!releasesRead.value() && releasesRead.error() && !releasesRead.loading()}>
                            <PaperEmptyState icon="error" title="Couldn't load">
                                <PaperButton onClick={() => void releasesRead.reload()}>Try again</PaperButton>
                            </PaperEmptyState>
                        </Show>
                        <UnsupportedHost game="Terraria" host={support()} />
                        <ReleaseSelector software={software()} value={version()} onChange={setVersion} />
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={2}>
                <InstallStep software={software()} version={version()} />
            </PaperWizardStep>
        </PaperWizard>
    );
}
