import { createSignal, onMount } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperPageHeader,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import InstallNotices from "../../components/InstallNotices";
import InstallProgressModal from "../../components/InstallProgressModal";
import { serverBridge, serverStatus } from "../../lib/server";
import { errorMessage, type Outcome } from "../../lib/failure";
import { createSteamInstall, type SteamInstallInfo } from "./installRows";

/**
 * Versions for a Steam dedicated server: Steam serves one current build, so
 * the tab shows what is installed and updates it in place.
 */
export default function SteamVersions(props: { name: string; infoAction: string; installAction: string }) {
    const [info, setInfo] = createSignal<SteamInstallInfo | null>(null);
    const [loadFailure, setLoadFailure] = createSignal<Outcome>();
    const [installOpen, setInstallOpen] = createSignal(false);
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

            <InstallNotices game={props.name} stopFor="update it" loadFailure={loadFailure()} host={info()?.host ?? null} />

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

            <InstallProgressModal
                open={installOpen()}
                rows={install.rows(props.name)}
                failure={install.error() ? { title: "Update failed", message: install.error() } : undefined}
                onDismiss={() => { setInstallOpen(false); install.reset(); }}
            />
        </>
    );
}
