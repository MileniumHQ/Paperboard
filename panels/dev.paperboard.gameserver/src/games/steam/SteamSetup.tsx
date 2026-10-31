import { createSignal, onCleanup, onMount, Show } from "solid-js";
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

function InstallStep(props: { name: string; infoAction: string; installAction: string }) {
    const wizard = useWizard();
    const install = createSteamInstall(props.installAction);
    const [done, setDone] = createSignal(false);
    const [blocked, setBlocked] = createSignal<{ title: string; reason: string } | null>(null);
    let disposed = false;
    onCleanup(() => { disposed = true; });

    const run = async () => {
        wizard?.setOptionsShown(false);
        wizard?.setCanProceed(false);
        const ok = await install.run();
        if (disposed) return;
        setDone(ok);
        wizard?.setCanProceed(ok);
        wizard?.setOptionsShown(true);
    };

    // the host is checked first, so an unsupported computer is told why instead of downloading
    onMount(async () => {
        wizard?.setOptionsShown(false);
        let info: SteamInstallInfo;
        try {
            info = await serverBridge.call<SteamInstallInfo>(props.infoAction);
        } catch (err) {
            if (!disposed) setBlocked({ title: `${props.name} could not be checked`, reason: errorMessage(err) });
            return;
        }
        if (disposed) return;
        if (!info.host.supported) setBlocked({ title: `This computer can't run ${props.name} yet`, reason: info.host.reason ?? "" });
        else void run();
    });

    return (
        <PaperCenteredInterface>
            <Show
                when={!blocked()}
                fallback={<PaperQuote variant="warning" title={blocked()!.title}>{blocked()!.reason}</PaperQuote>}
            >
                <PaperFlex direction="column" gap="full" center fullWidth>
                    <PaperText preset="title">{done() ? `${props.name} is ready` : "Setting things up..."}</PaperText>
                    <Show when={install.error()}>
                        <PaperQuote variant="danger" title="Setup failed">{install.error()}</PaperQuote>
                        <PaperButton onClick={() => void run()}>Retry setup</PaperButton>
                    </Show>
                    <InstallLoaders items={install.rows(props.name)} />
                </PaperFlex>
            </Show>
        </PaperCenteredInterface>
    );
}

/**
 * Setup for a game whose dedicated server comes from Steam: the download
 * starts at once. Steam always serves the current build, so there is no
 * version to pick.
 */
export default function SteamSetup(props: {
    name: string;
    infoAction: string;
    installAction: string;
    onComplete(): void;
}) {
    return (
        <PaperWizard showProgress={false} hideBack={true} finishLabel="Finish Setup" finishVariant="success" onComplete={props.onComplete}>
            <PaperWizardStep index={0}>
                <InstallStep name={props.name} infoAction={props.infoAction} installAction={props.installAction} />
            </PaperWizardStep>
        </PaperWizard>
    );
}
