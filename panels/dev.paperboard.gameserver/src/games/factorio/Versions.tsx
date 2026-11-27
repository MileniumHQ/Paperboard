import { createSignal, Show } from "solid-js";
import { createRead, PaperButton, PaperCard, PaperFlex, PaperIcon, PaperModal, PaperPageHeader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import InstallNotices from "../../components/InstallNotices";
import InstallProgressModal from "../../components/InstallProgressModal";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { createFactorioInstall } from "./installRows";

/** The release installed, and the newest one Paperboard installs, to update to or install again. */
export default function FactorioVersions() {
    const { calls, serverStatus } = useServer();
    const release = createRead(() => calls.factorioRelease(), { source: serverStatus, message: errorMessage });
    const loadFailure = () => {
        const error = release.error();
        return error === null ? undefined : { title: "Couldn't read Factorio's release", error, retry: () => void release.reload(), retrying: release.loading() };
    };
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const [installOpen, setInstallOpen] = createSignal(false);
    const install = createFactorioInstall();
    const latest = () => release.value()?.latest ?? "";
    const updating = () => release.value()?.updateAvailable === true;
    const canInstall = () => serverStatus() === "offline" && release.value()?.host.supported === true && !install.running();

    const run = async () => {
        setConfirmOpen(false);
        setInstallOpen(true);
        const ok = await install.run();
        await release.reload();
        if (ok) setInstallOpen(false);
    };

    return (
        <>
            <PaperPageHeader icon="deployed_code" title="Versions" />

            <InstallNotices game="Factorio" stopFor="update or reinstall it" loadFailure={loadFailure()} host={release.value()?.host ?? null} />

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center" fullWidth wrap>
                        <PaperText size={3} weight={700}>Factorio version</PaperText>
                        <PaperText size={2} color="text-subtle">Installed: {release.value()?.installed ?? "none"}</PaperText>
                    </PaperFlex>
                    <PaperText preset="body">
                        <Show when={release.value()} fallback="Reading the installed release...">
                            {updating()
                                ? `Factorio ${latest()} is out. Updating keeps the worlds, mods and lists.`
                                : `Factorio ${latest()} is the newest release Paperboard installs. Releases come with Paperboard's updates, each checked against the SHA-256 factorio.com lists.`}
                        </Show>
                    </PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperFlex direction="row" justify="flex-end" fullWidth>
                <PaperButton variant="success" disabled={!canInstall() || !release.value()} onClick={() => setConfirmOpen(true)}>
                    <PaperIcon>{updating() ? "update" : "build"}</PaperIcon>
                    {updating() ? `Update to Factorio ${latest()}` : `Reinstall Factorio ${latest()}`}
                </PaperButton>
            </PaperFlex>

            <PaperModal
                open={confirmOpen()}
                onClose={() => setConfirmOpen(false)}
                title={updating() ? "Update Factorio?" : "Reinstall Factorio?"}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="success" onClick={() => void run()}>{updating() ? "Update" : "Reinstall"}</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        This downloads Factorio {latest()} and replaces the server's program files. Worlds, mods and options are kept, and if the install fails the current server stays as it was.
                    </PaperText>
                    <Show when={updating()}>
                        <PaperQuote variant="warning" icon="warning" title="Back up first">
                            A world saved by a newer Factorio can't be opened by an older one. Back up your worlds first.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <InstallProgressModal
                open={installOpen()}
                rows={install.rows(latest())}
                failure={install.error() ? { title: updating() ? "Update failed" : "Reinstall failed", message: install.error() } : undefined}
                onDismiss={() => { setInstallOpen(false); install.reset(); }}
            />
        </>
    );
}
