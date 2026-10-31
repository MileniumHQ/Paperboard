import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperFlex,
    PaperQuote,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    useWizard,
} from "@mileniumhq/paperui";
import InstallLoaders from "../../components/InstallLoaders";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";

function InstallStep(props: { name: string; installAction: string }) {
    const wizard = useWizard();
    const install = createSteamInstall(props.installAction);
    let started = false;
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const run = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        const ok = await install.run();
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
                    <PaperButton onClick={() => void run()}>Retry setup</PaperButton>
                </Show>
                <InstallLoaders items={install.rows(props.name)} />
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

/**
 * Setup for a game whose dedicated server comes from Steam: what will be
 * downloaded, then the download. Steam always serves the current build, so
 * there is no version to pick.
 */
export default function SteamSetup(props: {
    name: string;
    /** what the server needs and what to expect, under the title */
    description: string;
    infoAction: string;
    installAction: string;
    onComplete(): void;
}) {
    const [info, setInfo] = createSignal<SteamInstallInfo | null>(null);
    const [loadError, setLoadError] = createSignal("");
    onMount(async () => {
        try {
            setInfo(await serverBridge.call<SteamInstallInfo>(props.infoAction));
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    });

    return (
        <PaperWizard showProgress={false} hideBack={true} finishLabel="Finish Setup" finishVariant="success" onComplete={props.onComplete}>
            <PaperWizardStep index={0} canProceed={info()?.host.supported === true}>
                <PaperCenteredInterface size="large">
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="title">{props.name} Dedicated Server</PaperText>
                        <PaperText preset="body">{props.description}</PaperText>
                        <Show when={loadError()}>
                            <PaperQuote variant="danger" title={`${props.name} could not be checked`}>{loadError()}</PaperQuote>
                        </Show>
                        <Show when={info() && !info()!.host.supported}>
                            <PaperQuote variant="warning" title={`This computer can't run ${props.name} yet`}>{info()!.host.reason}</PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1}>
                <InstallStep name={props.name} installAction={props.installAction} />
            </PaperWizardStep>
        </PaperWizard>
    );
}
