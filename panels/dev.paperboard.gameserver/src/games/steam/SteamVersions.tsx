import { createSignal, Show, type JSX } from "solid-js";
import {
    PaperBadge,
    createRead,
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperLoader,
    PaperPageHeader,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import InstallNotices from "../../components/InstallNotices";
import InstallProgressModal from "../../components/InstallProgressModal";
import { useServer } from "../../lib/server";
import { errorMessage, splitFailure } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo, type SteamUpdateStatus } from "./installRows";

/**
 * Versions for a Steam dedicated server: Steam serves one current build, so
 * the tab shows what is installed, asks Steam whether it is the newest, and
 * updates it in place.
 */
export default function SteamVersions(props: { name: string }) {
    const { calls, serverStatus } = useServer();
    const [installOpen, setInstallOpen] = createSignal(false);
    const install = createSteamInstall();
    // a failure's first line: a toast has no room for what SteamCMD printed after it
    const summary = (err: unknown) => splitFailure(errorMessage(err)).summary;
    const read = createRead((): Promise<SteamInstallInfo> => calls.steamInfo(), { message: summary, failure: { title: `Couldn't read the ${props.name} install` } });
    const info = read.value;
    const loadFailed = () => !read.loading() && !!read.error();
    // a check waits behind a download in progress, and asks Steam over the network
    const latest = createRead((): Promise<SteamUpdateStatus> => calls.steamLatest(), { message: summary, failure: { title: `Couldn't check ${props.name} for updates` } });
    const checking = latest.loading;
    // a failed check knows nothing of the newest build
    const status = () => (latest.error() ? undefined : latest.value());
    // checking again reads the install again too, when it could not be read
    const check = () => {
        if (loadFailed()) void read.reload();
        return latest.reload();
    };

    /** what the install says, once it is read; until then it is being read, or could not be */
    const installed = (fact: (read: SteamInstallInfo) => JSX.Element) => (
        <Show when={info()} fallback={loadFailed() ? "Not read" : <PaperLoader loaderStatus="indeterminate" size="small" label="Reading the install" />}>
            {(read) => fact(read())}
        </Show>
    );

    const canUpdate = () => serverStatus() === "offline" && info()?.host.supported === true && !install.running();
    const update = async () => {
        setInstallOpen(true);
        const ok = await install.run();
        await read.reload();
        if (ok) {
            setInstallOpen(false);
            await check();
        }
    };

    return (
        <>
            <PaperPageHeader icon="update" title="Updates" />

            <InstallNotices game={props.name} stopFor="update it" host={info()?.host ?? null} />

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
                                <td>{installed((read) => read.version ?? "Shown after the first start")}</td>
                            </tr>
                            <tr>
                                <th>Steam build</th>
                                <td>{installed((read) => read.build ?? "Not installed")}</td>
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
                failure={install.error() ? { title: `Couldn't update ${props.name}`, message: install.error() } : undefined}
                onDismiss={() => { setInstallOpen(false); install.reset(); }}
            />
        </>
    );
}
