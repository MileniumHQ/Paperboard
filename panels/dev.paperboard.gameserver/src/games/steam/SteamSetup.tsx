import { createSignal, onMount, Show, type JSX } from "solid-js";
import {
    PaperCenteredInterface,
    PaperQuote,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import { UnsupportedHost } from "../../components/InstallNotices";
import { serverBridge } from "../../lib/server";
import { errorMessage, type Outcome } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";

function InstallStep(props: { name: string; infoAction: string; installAction: string }) {
    const install = createSteamInstall(props.installAction);
    const { run, wizard, disposed } = createWizardInstall(install.run);
    const [blocked, setBlocked] = createSignal<{ failure?: Outcome; host?: SteamInstallInfo["host"] } | null>(null);

    // the host is checked first, so an unsupported computer is told why instead of downloading
    onMount(async () => {
        wizard?.setOptionsShown(false);
        let info: SteamInstallInfo;
        try {
            info = await serverBridge.call<SteamInstallInfo>(props.infoAction);
        } catch (err) {
            console.error(`[Setup] Failed to check ${props.name}:`, err);
            if (!disposed()) setBlocked({ failure: { title: `${props.name} could not be checked`, message: errorMessage(err) } });
            return;
        }
        if (disposed()) return;
        if (!info.host.supported) setBlocked({ host: info.host });
        else void run();
    });

    return (
        <Show
            when={!blocked()}
            fallback={
                <PaperCenteredInterface>
                    <UnsupportedHost game={props.name} host={blocked()!.host ?? null} />
                    <Show when={blocked()!.failure}>
                        {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}>{note().message}</PaperQuote>}
                    </Show>
                </PaperCenteredInterface>
            }
        >
            <InstallStepView rows={install.rows(props.name)} error={install.error()} onRetry={() => void run()} />
        </Show>
    );
}

/**
 * Setup for a game whose dedicated server comes from Steam: the download
 * starts at once. Steam always serves the current build, so there is no
 * version to pick. A game can follow it with one more step (`choose`), which
 * hands this a way to save what it asked once Finish Setup is pressed; setup
 * only finishes when that saved.
 */
export default function SteamSetup(props: {
    name: string;
    infoAction: string;
    installAction: string;
    choose?: (register: (save: () => Promise<boolean>) => void) => JSX.Element;
    onComplete(): void;
}) {
    let save: (() => Promise<boolean>) | undefined;
    const finish = async () => {
        if (!save || (await save())) props.onComplete();
    };
    return (
        <PaperWizard showProgress={false} hideBack={true} finishLabel="Finish Setup" finishVariant="success" onComplete={() => void finish()}>
            <PaperWizardStep index={0}>
                <InstallStep name={props.name} infoAction={props.infoAction} installAction={props.installAction} />
            </PaperWizardStep>
            <Show when={props.choose}>
                {(choose) => <PaperWizardStep index={1}>{choose()((fn) => { save = fn; })}</PaperWizardStep>}
            </Show>
        </PaperWizard>
    );
}
