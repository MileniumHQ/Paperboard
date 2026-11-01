import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperFlex,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import { UnsupportedHost, type HostSupport } from "../../components/InstallNotices";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { createTerrariaInstall } from "./installRows";
import ReleaseSelector, { releasesOf } from "./ReleaseSelector";
import { releases, SOFTWARE, softwareName, type TerrariaSoftware } from "./catalog";

/** what each software is, as the setup and Versions selectors describe it */
export const SOFTWARE_DESCRIPTION: Record<TerrariaSoftware, string> = {
    vanilla: "The official dedicated server from terraria.org.",
    tmodloader: "Mods from the Steam Workshop. Everyone who joins plays with tModLoader too.",
};

function InstallStep(props: { software: TerrariaSoftware; version: string }) {
    const install = createTerrariaInstall();
    const { run, wizard } = createWizardInstall(() => install.run(props.software, props.version));
    let started = false;

    createEffect(() => {
        if (wizard?.currentStep() === 2 && !started) {
            started = true;
            void run();
        }
    });

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
    const [hosts, setHosts] = createSignal<Record<TerrariaSoftware, HostSupport> | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const support = () => hosts()?.[software()] ?? null;
    onMount(async () => {
        try {
            const info = await serverBridge.call<{ hosts: Record<TerrariaSoftware, HostSupport> }>("terraria-versions");
            setHosts(info.hosts);
        } catch (err) {
            console.error("[Setup] Failed to read the Terraria releases:", err);
            setLoadError(errorMessage(err));
        }
    });

    return (
        <PaperWizard
            showProgress={false}
            hideBack={true}
            finishLabel="Finish Setup"
            finishVariant="success"
            onComplete={props.onComplete}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface size="large">
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
                                    <PaperSelectorItem value={id} description={SOFTWARE_DESCRIPTION[id]}>
                                        {softwareName(id)}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={support()?.supported === true}>
                <PaperCenteredInterface size="large">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Choose Version</PaperText>
                        <PaperText preset="body">
                            Select a release for your {software() === "tmodloader" ? "tModLoader" : "Terraria"} dedicated server. A world is created on the first start; to choose its size, difficulty and seed, make one in Worlds first.
                        </PaperText>
                        <Show when={loadError()}>
                            <PaperQuote variant="danger" icon="warning" title="Terraria releases could not be read">{loadError()}</PaperQuote>
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
