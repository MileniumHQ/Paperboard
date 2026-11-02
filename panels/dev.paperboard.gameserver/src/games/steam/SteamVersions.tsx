import { createSignal, onMount, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperLoader,
    PaperPageHeader,
    PaperQuote,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import InstallNotices from "../../components/InstallNotices";
import InstallProgressModal from "../../components/InstallProgressModal";
import { serverBridge, serverStatus } from "../../lib/server";
import { errorMessage, type Outcome } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo, type SteamUpdateStatus } from "./installRows";

/**
 * Versions for a Steam dedicated server: Steam serves one current build, so
 * the tab shows what is installed, asks Steam whether it is the newest, and
 * updates it in place.
 */
export default function SteamVersions(props: { name: string; infoAction: string; latestAction: string; installAction: string }) {
    const [info, setInfo] = createSignal<SteamInstallInfo | null>(null);
    const [loadFailure, setLoadFailure] = createSignal<Outcome>();
    const [installOpen, setInstallOpen] = createSignal(false);
    const [status, setStatus] = createSignal<SteamUpdateStatus>();
    const [checking, setChecking] = createSignal(false);
    const [checkFailure, setCheckFailure] = createSignal<Outcome>();
    const install = createSteamInstall(props.installAction);

    const load = async () => {
        try {
            setInfo(await serverBridge.call<SteamInstallInfo>(props.infoAction));
            setLoadFailure(undefined);
        } catch (err) {
            console.error(`[Updates] Failed to read the ${props.name} install:`, err);
            setLoadFailure({ title: `The ${props.name} install could not be read`, message: errorMessage(err) });
        }
    };

    // a check waits behind a download in progress, and asks Steam over the network
    const check = async () => {
        setChecking(true);
        try {
            setStatus(await serverBridge.call<SteamUpdateStatus>(props.latestAction, undefined, { timeoutMs: null }));
            setCheckFailure(undefined);
        } catch (err) {
            console.error(`[Updates] Failed to check for ${props.name} updates:`, err);
            setStatus(undefined);
            setCheckFailure({ title: `${props.name} could not be checked for updates`, message: errorMessage(err) });
        } finally {
            setChecking(false);
        }
    };
    onMount(() => { void load(); void check(); });

    const canUpdate = () => serverStatus() === "offline" && info()?.host.supported === true && !install.running();
    const update = async () => {
        setInstallOpen(true);
        const ok = await install.run();
        await load();
        if (ok) {
            setInstallOpen(false);
            await check();
        }
    };

    return (
        <>
            <PaperPageHeader icon="update" title="Updates" />

            <InstallNotices game={props.name} stopFor="update it" loadFailure={loadFailure()} host={info()?.host ?? null} />

            <Show when={checkFailure()}>
                {(note) => <PaperQuote variant="danger" icon="warning" title={note().title}>{note().message}</PaperQuote>}
            </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperText size={3} weight={700}>{props.name} dedicated server</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        Steam serves the newest release. Updating downloads only what changed and keeps your options and saved data.
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
                            <tr>
                                <th>Latest build</th>
                                <td>
                                    <Show when={!checking()} fallback={<PaperLoader loaderStatus="indeterminate" size="small" label="Checking Steam" />}>
                                        {status()?.latest ?? "Not checked"}
                                    </Show>
                                </td>
                            </tr>
                            <tr>
                                <th>Status</th>
                                <td>
                                    <Show when={status() && !checking()} fallback="Not checked">
                                        <Show when={status()!.installed === null} fallback={
                                            <Show when={status()!.updateAvailable} fallback={<PaperBadge variant="success" icon="check_circle">Up to date</PaperBadge>}>
                                                <PaperBadge variant="warning" icon="update">Update available</PaperBadge>
                                            </Show>
                                        }>
                                            Not installed
                                        </Show>
                                    </Show>
                                </td>
                            </tr>
                        </tbody>
                    </PaperTable>
                </PaperFlex>
            </PaperCard>

            <PaperFlex direction="row" justify="flex-end" gap="full" fullWidth>
                <PaperButton variant="outline" disabled={checking() || install.running()} onClick={() => void check()}>
                    <PaperIcon>refresh</PaperIcon>
                    {checking() ? "Checking…" : "Check for updates"}
                </PaperButton>
                <PaperButton variant="success" disabled={!canUpdate()} onClick={() => void update()}>
                    <PaperIcon>update</PaperIcon>
                    Update {props.name}
                </PaperButton>
            </PaperFlex>

            <InstallProgressModal
                open={installOpen()}
                rows={install.rows(props.name)}
                failure={install.error() ? { title: "Update failed", message: install.error() } : undefined}
                onDismiss={() => { setInstallOpen(false); install.reset(); }}
            />
        </>
    );
}
