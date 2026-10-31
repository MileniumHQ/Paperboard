import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
} from "@mileniumhq/paperui";
import InstallLoaders from "../../components/InstallLoaders";
import { serverBridge, serverSoftware, serverStatus, serverVersion } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { softwareName, terrariaSoftware } from "./catalog";
import { releasesOf } from "./Setup";
import { createTerrariaInstall } from "./installRows";

export default function TerrariaVersions() {
    // a server keeps the software it was made with; only its releases are offered
    const software = () => terrariaSoftware(serverSoftware());
    const name = () => (software() === "tmodloader" ? "tModLoader" : "Terraria");
    const [selected, setSelected] = createSignal(serverVersion() || releasesOf(software())[0]!.version);
    const [support, setSupport] = createSignal<{ supported: boolean; reason?: string } | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const [installOpen, setInstallOpen] = createSignal(false);
    const install = createTerrariaInstall();
    const reinstall = () => selected() === serverVersion();

    onMount(async () => {
        try {
            setSupport((await serverBridge.call<{ hosts: Record<string, { supported: boolean; reason?: string }> }>("terraria-versions")).hosts[software()] ?? null);
        } catch (err) {
            setLoadError(errorMessage(err));
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

            <Show when={serverStatus() !== "offline"}>
                <PaperQuote variant="warning" icon="warning" title="Server running">
                    Stop the server to reinstall or change its version.
                </PaperQuote>
            </Show>
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Terraria releases could not be read">
                    {loadError()}
                </PaperQuote>
            </Show>
            <Show when={support() && !support()!.supported}>
                <PaperQuote variant="warning" icon="warning" title="This computer can't run Terraria yet">
                    {support()!.reason}
                </PaperQuote>
            </Show>

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
                    <PaperSelector name="terrariaVersion" value={selected()} onValueChange={(value) => setSelected(String(value))}>
                        <For each={releasesOf(software())}>
                            {(release, index) => (
                                <PaperSelectorItem
                                    value={release.version}
                                    description={index() === 0 ? <><strong>Latest.</strong> {release.description}</> : release.description}
                                >
                                    {softwareName(software())} {release.version}
                                </PaperSelectorItem>
                            )}
                        </For>
                    </PaperSelector>
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
                        <PaperButton onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
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

            <PaperModal
                open={installOpen()}
                size="medium"
                noHeader
                closeOnBackdropClick={false}
                closeOnEsc={false}
                footer={
                    install.error() ? (
                        <PaperButton onClick={() => { setInstallOpen(false); install.reset(); }}>Dismiss</PaperButton>
                    ) : undefined
                }
            >
                <PaperFlex fullWidth center>
                    <PaperFlex fullWidth maxWidth="panel-small">
                        <InstallLoaders items={install.rows(software(), selected())} />
                        <Show when={install.error()}>
                            <PaperQuote variant="danger" icon="warning" title={reinstall() ? "Reinstall failed" : "Switch failed"}>
                                {install.error()}
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
