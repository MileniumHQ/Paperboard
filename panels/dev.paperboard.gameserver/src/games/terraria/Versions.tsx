import { createSignal, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperText,
} from "@mileniumhq/paperui";
import InstallNotices, { type HostSupport } from "../../components/InstallNotices";
import InstallProgressModal from "../../components/InstallProgressModal";
import { serverBridge, serverSoftware, serverStatus, serverVersion } from "../../lib/server";
import { errorMessage, type Outcome } from "../../lib/failure";
import { softwareName, terrariaSoftware } from "./catalog";
import ReleaseSelector, { releasesOf } from "./ReleaseSelector";
import { createTerrariaInstall } from "./installRows";

export default function TerrariaVersions() {
    // a server keeps the software it was made with; only its releases are offered
    const software = () => terrariaSoftware(serverSoftware());
    const name = () => (software() === "tmodloader" ? "tModLoader" : "Terraria");
    const [selected, setSelected] = createSignal(serverVersion() || releasesOf(software())[0]!.version);
    const [support, setSupport] = createSignal<HostSupport | null>(null);
    const [loadFailure, setLoadFailure] = createSignal<Outcome>();
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const [installOpen, setInstallOpen] = createSignal(false);
    const install = createTerrariaInstall();
    const reinstall = () => selected() === serverVersion();

    onMount(async () => {
        try {
            setSupport((await serverBridge.call<{ hosts: Record<string, HostSupport> }>("terraria-versions")).hosts[software()] ?? null);
        } catch (err) {
            console.error("[Versions] Failed to read the Terraria releases:", err);
            setLoadFailure({ title: "Terraria releases could not be read", message: errorMessage(err) });
        }
    });

    const canInstall = () => serverStatus() === "offline" && support()?.supported === true && !install.running();

    const run = async () => {
        setConfirmOpen(false);
        setInstallOpen(true);
        if (await install.run(software(), selected())) setInstallOpen(false);
    };

    return (
        <>
            <PaperPageHeader icon="deployed_code" title="Versions" />

            <InstallNotices game="Terraria" stopFor="reinstall or change its version" loadFailure={loadFailure()} host={support()} />

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperFlex direction="row" justify="space-between" align="center" fullWidth>
                        <PaperText size={3} weight={700}>
                            {name()} version
                        </PaperText>
                        <PaperText size={2} color="text-subtle">
                            Installed: {serverVersion() ? `${softwareName(software())} ${serverVersion()}` : "none"}
                        </PaperText>
                    </PaperFlex>
                    <ReleaseSelector software={software()} value={selected()} onChange={setSelected} />
                </PaperFlex>
            </PaperCard>

            <PaperFlex direction="row" justify="flex-end" fullWidth>
                <PaperButton variant="success" disabled={!canInstall()} onClick={() => setConfirmOpen(true)}>
                    <PaperIcon>{reinstall() ? "build" : "swap_vert"}</PaperIcon>
                    {reinstall() ? `Reinstall ${name()} ${selected()}` : `Switch to ${name()} ${selected()}`}
                </PaperButton>
            </PaperFlex>

            <PaperModal
                open={confirmOpen()}
                onClose={() => setConfirmOpen(false)}
                title={reinstall() ? `Reinstall ${name()}?` : "Switch version?"}
                size="small"
                footer={
                    <>
                        <PaperButton variant={reinstall() ? "text" : undefined} onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant={reinstall() ? "success" : "danger"} onClick={() => void run()}>
                            {reinstall() ? "Reinstall" : "Switch anyway"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        {reinstall()
                            ? `This downloads ${name()} ${selected()} again and replaces the server's program files. Worlds and options are kept.`
                            : `This replaces the installed server with ${name()} ${selected()}. If the install fails, the current server is kept as it was.`}
                    </PaperText>
                    <Show when={!reinstall()}>
                        <PaperQuote variant="warning" icon="warning" title="Back up first">
                            A newer Terraria can upgrade a world so older releases can't open it. Back up your worlds first.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <InstallProgressModal
                open={installOpen()}
                rows={install.rows(software(), selected())}
                failure={install.error() ? { title: reinstall() ? "Reinstall failed" : "Switch failed", message: install.error() } : undefined}
                onDismiss={() => { setInstallOpen(false); install.reset(); }}
            />
        </>
    );
}
