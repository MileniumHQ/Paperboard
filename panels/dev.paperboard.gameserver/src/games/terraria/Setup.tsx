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
import { releases } from "./catalog";

function InstallStep(props: { version: string }) {
    const wizard = useWizard();
    const install = createTerrariaInstall();
    let started = false;
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const run = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        const ok = await install.run(props.version);
        if (disposed) return;
        wizard?.setCanProceed(ok);
        wizard?.setOptionsShown(true);
    };

    createEffect(() => {
        if (wizard?.currentStep() === 1 && !started) {
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
                        <PaperButton onClick={() => { started = false; install.reset(); wizard?.setCurrentStep(0); }}>Change version</PaperButton>
                    </PaperFlex>
                </Show>
                <InstallLoaders items={install.rows(props.version)} />
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

export default function TerrariaSetup(props: { onComplete(): void }) {
    const [version, setVersion] = createSignal<string>(releases[0].version);
    const [support, setSupport] = createSignal<{ supported: boolean; reason?: string } | null>(null);
    const [loadError, setLoadError] = createSignal("");
    onMount(async () => {
        try {
            const info = await serverBridge.call<{ host: { supported: boolean; reason?: string } }>("terraria-versions");
            setSupport(info.host);
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
            <PaperWizardStep index={0} canProceed={support()?.supported === true}>
                <PaperCenteredInterface size="large">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">Choose Version</PaperText>
                        <PaperText preset="body">
                            Select a release for your Terraria dedicated server. A world is created on the first start; to choose its size, difficulty and seed, make one in Worlds first.
                        </PaperText>
                        <Show when={loadError()}>
                            <PaperQuote variant="danger" title="Terraria releases could not be read">{loadError()}</PaperQuote>
                        </Show>
                        <Show when={support() && !support()!.supported}>
                            <PaperQuote variant="warning" title="This computer can't run Terraria yet">{support()!.reason}</PaperQuote>
                        </Show>
                        <PaperSelector name="terrariaVersion" value={version()} onValueChange={(value) => setVersion(String(value))}>
                            <For each={releases}>
                                {(release, index) => (
                                    <PaperSelectorItem
                                        value={release.version}
                                        description={
                                            index() === 0 ? (
                                                <><strong>Latest.</strong> Vanilla dedicated server from terraria.org.</>
                                            ) : (
                                                "Vanilla dedicated server from terraria.org."
                                            )
                                        }
                                    >
                                        Terraria {release.version}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1}>
                <InstallStep version={version()} />
            </PaperWizardStep>
        </PaperWizard>
    );
}
