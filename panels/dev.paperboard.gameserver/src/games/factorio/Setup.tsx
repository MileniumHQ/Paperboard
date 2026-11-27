import { createSignal, onMount, Show } from "solid-js";
import { PaperButton, PaperCenteredInterface, PaperEmptyState, PaperError, PaperWizard, PaperWizardStep, formatBytes } from "@mileniumhq/paperui";
import InstallStepView, { createWizardInstall } from "../../components/InstallStepView";
import InstallLoaders from "../../components/InstallLoaders";
import { UnsupportedHost, type HostSupport } from "../../components/InstallNotices";
import { errorMessage } from "../../lib/failure";
import { useServer } from "../../lib/server";
import { createFactorioInstall } from "./installRows";

interface Release { host: HostSupport; installed: string | null; latest: string; size: number }

function InstallStep() {
    const { calls, installProgress } = useServer();
    const install = createFactorioInstall();
    const { run, wizard, disposed } = createWizardInstall(install.run);
    const [release, setRelease] = createSignal<Release | null>(null);
    const [failure, setFailure] = createSignal<string | null>(null);
    const [started, setStarted] = createSignal(false);
    const download = () => {
        setStarted(true);
        void run();
    };

    // the host is checked first, so an unsupported computer is told why instead of downloading
    const check = async () => {
        setFailure(null);
        let info: Release;
        try {
            info = await calls.factorioRelease();
        } catch (err) {
            if (!disposed()) setFailure(errorMessage(err));
            return;
        }
        if (disposed()) return;
        setRelease(info);
        if (!info.host.supported) return;
        if (info.installed) {
            // setup opened again after its download goes on, not to a second download
            install.finished();
            wizard?.setCanProceed(true);
            wizard?.setOptionsShown(true);
        } else if (["preparing", "downloading", "verifying", "installing"].includes(installProgress()?.stage ?? "")) {
            // an install already running is followed, not started again
            download();
        }
    };
    onMount(() => {
        wizard?.setOptionsShown(false);
        void check();
    });

    return (
        <PaperCenteredInterface>
            <Show when={failure()}>
                {(err) => <PaperError fill title="Couldn't check Factorio" error={err()} action={{ label: "Try again", onClick: () => void check() }} />}
            </Show>
            <UnsupportedHost game="Factorio" host={release()?.host ?? null} />
            <Show when={!failure() && !release()}>
                <InstallLoaders items={[{ label: "Checking Factorio", done: "", percent: () => 0, status: () => "indeterminate" }]} />
            </Show>
            <Show when={release()?.host.supported ? release() : null}>
                {(info) => (
                    <Show
                        when={started() || info().installed}
                        fallback={
                            <PaperEmptyState
                                icon="download"
                                title="Factorio isn't downloaded yet"
                                description={`Its free headless server is ${formatBytes(info().size)} from factorio.com. Players join with their own copy of the game.`}
                            >
                                <PaperButton onClick={download}>Download Factorio {info().latest}</PaperButton>
                            </PaperEmptyState>
                        }
                    >
                        <InstallStepView rows={install.rows(info().installed ?? info().latest)} error={install.error()} onRetry={() => void run()} />
                    </Show>
                )}
            </Show>
        </PaperCenteredInterface>
    );
}

/** Setup for Factorio: the free headless server from factorio.com, which needs no account. */
export default function FactorioSetup(props: { onComplete(): void }) {
    return (
        <PaperWizard showProgress={false} hideBack={true} finishLabel="Finish Setup" finishVariant="success" onComplete={props.onComplete}>
            <PaperWizardStep index={0}>
                <InstallStep />
            </PaperWizardStep>
        </PaperWizard>
    );
}
