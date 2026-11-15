import { createSignal, onMount, Show, type JSX } from "solid-js";
import {
    PaperCenteredInterface,
    PaperQuote,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import { UnsupportedHost } from "../../components/InstallNotices";
import { useServer } from "../../lib/server";
import { errorMessage, type Outcome } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";
import FailureText from "../../components/FailureText";

function InstallStep(props: { name: string }) {
    const { calls } = useServer();
    const install = createSteamInstall();
    const { run, wizard, disposed } = createWizardInstall(install.run);
    const [blocked, setBlocked] = createSignal<{ failure?: Outcome; host?: SteamInstallInfo["host"] } | null>(null);

    // the host is checked first, so an unsupported computer is told why instead of downloading
    onMount(async () => {
        wizard?.setOptionsShown(false);
        let info: SteamInstallInfo;
        try {
            info = await calls.steamInfo();
        } catch (err) {
            if (!disposed()) setBlocked({ failure: { title: `${props.name} could not be checked`, message: errorMessage(err) } });
            return;
        }
        if (disposed()) return;
        if (!info.host.supported) setBlocked({ host: info.host });
        else if (info.downloaded) {
            // setup left after the download opens at its next question, not at a second download
            install.finished();
            wizard?.setCanProceed(true);
            wizard?.setOptionsShown(true);
            if (wizard && !wizard.isLastStep()) wizard.nextStep();
        } else void run();
    });

    return (
        <Show
            when={!blocked()}
            fallback={
                <PaperCenteredInterface>
                    <UnsupportedHost game={props.name} host={blocked()!.host ?? null} />
                    <Show when={blocked()!.failure}>
                        {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}><FailureText message={note().message} /></PaperQuote>}
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
 * version to pick. A game can follow it with its own steps (`steps`, each a
 * PaperWizardStep from index 1, the first with `hideBack` since the download
 * is done), and `save` keeps what they asked once Finish Setup is pressed;
 * setup only finishes when that saved.
 */
export default function SteamSetup(props: {
    name: string;
    steps?: JSX.Element;
    save?: () => Promise<boolean>;
    onComplete(): void;
}) {
    const finish = async () => {
        if (!props.save || (await props.save())) props.onComplete();
    };
    return (
        <PaperWizard showProgress={false} finishLabel="Finish Setup" finishVariant="success" onComplete={() => void finish()}>
            <PaperWizardStep index={0}>
                <InstallStep name={props.name} />
            </PaperWizardStep>
            {props.steps}
        </PaperWizard>
    );
}
