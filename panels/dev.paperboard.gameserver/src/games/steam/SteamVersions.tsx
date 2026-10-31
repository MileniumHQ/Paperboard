import { createSignal, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import InstallLoaders from "../../components/InstallLoaders";
import { serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";

/**
 * Versions for a Steam dedicated server: Steam serves one current build, so
 * the tab shows what is installed and updates it in place.
 */
export default function SteamVersions(props: { name: string; infoAction: string; installAction: string }) {
    const [info, setInfo] = createSignal<SteamInstallInfo | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [installOpen, setInstallOpen] = createSignal(false);
    const install = createSteamInstall(props.installAction);

    const load = async () => {
        try {
            setInfo(await serverBridge.call<SteamInstallInfo>(props.infoAction));
            setLoadError("");
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    onMount(() => void load());

    const canUpdate = () => serverStatus() === "offline" && info()?.host.supported === true && !install.running();
    const update = async () => {
        setInstallOpen(true);
        const ok = await install.run();
        await load();
        if (ok) setInstallOpen(false);
    };

    return (
        <>
            <PaperPageHeader icon="update" title="Updates" />

            <Show when={serverStatus() !== "offline"}>
                <PaperQuote variant="warning" icon="warning" title="Server running">
                    Stop the server to update it.
                </PaperQuote>
            </Show>
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title={`The ${props.name} install could not be read`}>
                    {loadError()}
                </PaperQuote>
            </Show>
            <Show when={info() && !info()!.host.supported}>
                <PaperQuote variant="warning" icon="warning" title={`This computer can't run ${props.name} yet`}>
                    {info()!.host.reason}
                </PaperQuote>
            </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperText size={3} weight={700}>{props.name} dedicated server</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        Steam serves the newest release. Updating downloads only what changed, and keeps worlds and options.
                    </PaperText>
                    <PaperTable>
                        <tbody>
                            <tr>
                                <th>Version</th>
                                <td>{info()?.version ?? "Shown after the first start"}</td>
                            </tr>
                            <tr>
                                <th>Steam build</th>
                                <td>{info()?.build ?? "Not installed"}</td>
                            </tr>
                        </tbody>
                    </PaperTable>
                </PaperFlex>
            </PaperCard>

            <PaperFlex direction="row" justify="flex-end" fullWidth>
                <PaperButton variant="success" disabled={!canUpdate()} onClick={() => void update()}>
                    <PaperIcon>update</PaperIcon>
                    Update {props.name}
                </PaperButton>
            </PaperFlex>

            <PaperModal
                open={installOpen()}
                size="medium"
                noHeader
                closeOnBackdropClick={false}
                closeOnEsc={false}
                footer={install.error() ? <PaperButton onClick={() => { setInstallOpen(false); install.reset(); }}>Dismiss</PaperButton> : undefined}
            >
                <PaperFlex fullWidth center>
                    <PaperFlex fullWidth maxWidth="panel-small">
                        <InstallLoaders items={install.rows(props.name)} />
                        <Show when={install.error()}>
                            <PaperQuote variant="danger" icon="warning" title="Update failed">
                                {install.error()}
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
