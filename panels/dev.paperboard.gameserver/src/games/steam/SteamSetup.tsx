import { createSignal, onMount, Show, type JSX } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperEmptyState,
    PaperModal,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    showError,
} from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import { UnsupportedHost } from "../../components/InstallNotices";
import { useServer } from "../../lib/server";
import { errorMessage, splitFailure } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";
import FailureOutput from "../../components/FailureOutput";
import InstallLoaders from "../../components/InstallLoaders";
import { formatSize } from "../../lib/addons/presentation";

function InstallStep(props: { name: string }) {
    const { calls, installProgress } = useServer();
    const install = createSteamInstall();
    const { run, wizard, disposed } = createWizardInstall(install.run);
    // what stops the download: a computer the game can't run on, or a check that failed (its words, with SteamCMD's output)
    const [blocked, setBlocked] = createSignal<{ failure?: string; host?: SteamInstallInfo["host"] } | null>(null);
    // the download's size, asked of Steam before it starts; the user says when it does
    const [size, setSize] = createSignal<number | null>(null);
    const [asking, setAsking] = createSignal(false);
    const [started, setStarted] = createSignal(false);
    const download = () => {
        setAsking(false);
        setStarted(true);
        void run();
    };

    /** a check that failed: the toast says why, and the step offers Try again */
    const failed = (title: string, err: unknown) => {
        if (disposed()) return;
        const message = errorMessage(err);
        setBlocked({ failure: message });
        showError(title, splitFailure(message).summary);
    };

    // the host is checked first, so an unsupported computer is told why instead of downloading
    const check = async () => {
        setBlocked(null);
        let info: SteamInstallInfo;
        try {
            info = await calls.steamInfo();
        } catch (err) {
            failed(`Couldn't check ${props.name}`, err);
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
        } else if (["preparing", "downloading", "verifying", "installing"].includes(installProgress()?.stage ?? "")) {
            // an install already running is followed, not asked about again
            download();
        } else {
            let bytes: number;
            try {
                bytes = await calls.steamSize();
            } catch (err) {
                failed(`Couldn't read ${props.name}'s download size`, err);
                return;
            }
            if (disposed()) return;
            setSize(bytes);
            setAsking(true);
        }
    };
    onMount(() => {
        wizard?.setOptionsShown(false);
        void check();
    });

    return (
        <Show
            when={!blocked()}
            fallback={
                <PaperCenteredInterface>
                    <UnsupportedHost game={props.name} host={blocked()!.host ?? null} />
                    <Show when={blocked()!.failure}>
                        {(message) => (
                            <>
                                <PaperEmptyState icon="error" title="Couldn't load">
                                    <PaperButton onClick={() => void check()}>Try again</PaperButton>
                                </PaperEmptyState>
                                {/* what SteamCMD printed, which the toast leaves out */}
                                <FailureOutput message={message()} />
                            </>
                        )}
                    </Show>
                </PaperCenteredInterface>
            }
        >
            <Show
                when={started()}
                fallback={
                    <PaperCenteredInterface>
                        <Show
                            when={size()}
                            fallback={<InstallLoaders items={[{ label: `Checking ${props.name}'s download size`, done: "", percent: () => 0, status: () => "indeterminate" }]} />}
                        >
                            {(bytes) => (
                                <PaperEmptyState icon="download" title={`${props.name} isn't downloaded yet`} description={`Its server is ${formatSize(bytes())} from Steam.`}>
                                    <PaperButton onClick={() => setAsking(true)}>Download</PaperButton>
                                </PaperEmptyState>
                            )}
                        </Show>
                    </PaperCenteredInterface>
                }
            >
                <InstallStepView rows={install.rows(props.name)} error={install.error()} onRetry={() => void run()} />
            </Show>
            <PaperModal
                open={asking()}
                onClose={() => setAsking(false)}
                title={`Download ${props.name}?`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setAsking(false)}>Cancel</PaperButton>
                        <PaperButton onClick={download}>Download {formatSize(size() ?? 0)}</PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {props.name}'s server is a {formatSize(size() ?? 0)} download from Steam. Setup goes on once it's here.
                </PaperText>
            </PaperModal>
        </Show>
    );
}

/**
 * Setup for a game whose dedicated server comes from Steam: the download
 * starts once the user has seen its size and said so. Steam always serves the current build, so there is no
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
