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
    type LoaderStatus,
} from "@mileniumhq/paperui";
import InstallLoaders from "../../components/InstallLoaders";
import { installProgress, serverBridge } from "../../lib/server";
import { releases } from "./catalog";

function InstallStep(props: { version: string }) {
    const wizard = useWizard();
    const [error, setError] = createSignal("");
    const [installed, setInstalled] = createSignal(false);
    let started = false;
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const install = async () => {
        setError("");
        setInstalled(false);
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        try {
            await serverBridge.call("terraria-install", { version: props.version }, { timeoutMs: null });
            if (disposed) return;
            setInstalled(true);
            wizard?.setCanProceed(true);
        } catch (err) {
            if (disposed) return;
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (!disposed) wizard?.setOptionsShown(true);
        }
    };

    createEffect(() => {
        if (wizard?.currentStep() === 1 && !started) {
            started = true;
            void install();
        }
    });

    // the download reports its own progress; unpacking follows it
    const stage = () => installProgress()?.stage;
    const downloaded = () => installed() || stage() === "completed";
    const downloadStatus = (): LoaderStatus =>
        error() && !downloaded() ? "error" : downloaded() ? "success" : stage() ? "loading" : "waiting";
    const setupStatus = (): LoaderStatus =>
        error() && downloaded() ? "error" : installed() ? "success" : downloaded() ? "indeterminate" : "waiting";

    return (
        <PaperCenteredInterface>
            <PaperFlex direction="column" gap="full" center fullWidth>
                <Show when={error()}>
                    <PaperQuote variant="danger" title="Setup failed">{error()}</PaperQuote>
                    <PaperFlex gap="half">
                        <PaperButton onClick={() => void install()}>Retry setup</PaperButton>
                        <PaperButton onClick={() => { started = false; setError(""); wizard?.setCurrentStep(0); }}>Change version</PaperButton>
                    </PaperFlex>
                </Show>
                <InstallLoaders
                    items={[
                        {
                            label: `Downloading Terraria ${props.version}...`,
                            percent: () => (downloaded() ? 100 : installProgress()?.percent ?? 0),
                            status: downloadStatus,
                        },
                        {
                            label: "Setting up server...",
                            percent: () => (installed() ? 100 : 0),
                            status: setupStatus,
                        },
                    ]}
                />
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
                            Select a release for your Terraria dedicated server. A small world is created on first start; set its size, difficulty and seed in Options before starting.
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
