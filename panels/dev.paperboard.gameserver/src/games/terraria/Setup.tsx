import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
    useWizard,
} from "@mileniumhq/paperui";
import InstallLoaders from "../../components/InstallLoaders";
import { serverBridge } from "../../lib/server";
import { createTerrariaInstall } from "./installRows";
import { releases, SOFTWARE, softwareName, tmodloaderReleases, type TerrariaSoftware } from "./catalog";

type Host = { supported: boolean; reason?: string };

/** what each software is, as the setup and Versions selectors describe it */
export const SOFTWARE_DESCRIPTION: Record<TerrariaSoftware, string> = {
    vanilla: "The official dedicated server from terraria.org.",
    tmodloader: "Mods from the Steam Workshop. Everyone who joins plays with tModLoader too.",
};

/** a software's releases, newest first, as the version selectors list them */
export const releasesOf = (software: TerrariaSoftware): { version: string; description: string }[] =>
    software === "tmodloader"
        ? tmodloaderReleases.map((r) => ({ version: r.version, description: `tModLoader from GitHub, made from Terraria ${r.terraria}.` }))
        : releases.map((r) => ({ version: r.version, description: "Vanilla dedicated server from terraria.org." }));

function InstallStep(props: { software: TerrariaSoftware; version: string }) {
    const wizard = useWizard();
    const install = createTerrariaInstall();
    let started = false;
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const run = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        const ok = await install.run(props.software, props.version);
        if (disposed) return;
        wizard?.setCanProceed(ok);
        wizard?.setOptionsShown(true);
    };

    createEffect(() => {
        if (wizard?.currentStep() === 2 && !started) {
            started = true;
            void run();
        }
    });

    return (
        <PaperCenteredInterface>
            <PaperFlex direction="column" gap="full" center fullWidth>
                <Show when={install.error()}>
                    <PaperQuote variant="danger" title="Setup failed">{install.error()}</PaperQuote>
                    <PaperFlex gap="half">
                        <PaperButton onClick={() => void run()}>Retry setup</PaperButton>
                        <PaperButton onClick={() => { started = false; install.reset(); wizard?.setCurrentStep(1); }}>Change version</PaperButton>
                    </PaperFlex>
                </Show>
                <InstallLoaders items={install.rows(props.software, props.version)} />
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

export default function TerrariaSetup(props: { onComplete(): void }) {
    const [software, setSoftware] = createSignal<TerrariaSoftware>("vanilla");
    const [version, setVersion] = createSignal<string>(releases[0].version);
    const [hosts, setHosts] = createSignal<Record<TerrariaSoftware, Host> | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const support = () => hosts()?.[software()] ?? null;
    onMount(async () => {
        try {
            const info = await serverBridge.call<{ hosts: Record<TerrariaSoftware, Host> }>("terraria-versions");
            setHosts(info.hosts);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
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
                            <PaperQuote variant="danger" title="Terraria releases could not be read">{loadError()}</PaperQuote>
                        </Show>
                        <Show when={support() && !support()!.supported}>
                            <PaperQuote variant="warning" title="This computer can't run Terraria yet">{support()!.reason}</PaperQuote>
                        </Show>
                        <PaperSelector name="terrariaVersion" value={version()} onValueChange={(value) => setVersion(String(value))}>
                            <For each={releasesOf(software())}>
                                {(release, index) => (
                                    <PaperSelectorItem
                                        value={release.version}
                                        description={index() === 0 ? <><strong>Latest.</strong> {release.description}</> : release.description}
                                    >
                                        {softwareName(software())} {release.version}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={2}>
                <InstallStep software={software()} version={version()} />
            </PaperWizardStep>
        </PaperWizard>
    );
}
