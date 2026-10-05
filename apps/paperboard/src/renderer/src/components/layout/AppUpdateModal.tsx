import { createSignal, Show } from "solid-js";
import { PaperModal, PaperFlex, PaperText, PaperButton, PaperProgress } from "@mileniumhq/paperui";
import type { AppUpdateState } from "../../../../shared/appUpdate";
import { shellIpc } from "../../lib/shell";

export default function AppUpdateModal(props: { state: AppUpdateState; open: boolean; onClose(): void }) {
    const [downloadError, setDownloadError] = createSignal<string | null>(null);
    const failed = () => props.state.status === "failed";
    const ready = () => props.state.status === "ready";
    const packageManaged = () => props.state.installMode === "package-manager";
    const openDownload = async () => {
        setDownloadError(null);
        try { await shellIpc().invoke("open-update-download"); }
        catch (err) { setDownloadError(`Could not open downloads: ${String(err)}`); }
    };
    return <PaperModal
        open={props.open}
        onClose={props.onClose}
        title={failed() ? "Paperboard update failed" : ready() ? "Paperboard update ready" : "Paperboard update available"}
        size="medium"
        footer={<PaperFlex direction="row" gap="full" justify="flex-end" style={{ "flex-wrap": "wrap" }}>
            <PaperButton variant="text" onClick={props.onClose}>Later</PaperButton>
            <Show when={failed()}>
                <Show when={!packageManaged()}><PaperButton variant="text" onClick={openDownload}>Download manually</PaperButton></Show>
                <PaperButton onClick={() => shellIpc().send("relaunch-for-update")}>{packageManaged() ? "Retry check" : "Retry update"}</PaperButton>
            </Show>
            <Show when={ready()}>
                <PaperButton variant="text" onClick={() => shellIpc().send("quit-and-install")}>Restart to update</PaperButton>
            </Show>
        </PaperFlex>}
    >
        <PaperFlex direction="column" gap="full">
            <PaperText>
                {packageManaged() ? `${props.state.status === "manual" ? `Paperboard ${props.state.version} is available.` : "Paperboard could not check for updates."} Update Paperboard with the package manager you used to install it. You can keep using this version in the meantime.`
                    : failed() ? `${props.state.version ? `Version ${props.state.version} is available, but the update could not finish.` : "Paperboard could not check for or install an update."} You can keep using Paperboard and retry, or download the latest installer.`
                    : ready() ? `Version ${props.state.version} is downloaded. Restart Paperboard to apply it.`
                    : `Downloading Paperboard ${props.state.version ?? ""}${props.state.percent === null ? "…" : `: ${props.state.percent}%`}`}
            </PaperText>
            <Show when={failed() && props.state.error}>
                <PaperText color="danger" style={{ "overflow-wrap": "anywhere" }}>{props.state.error}</PaperText>
            </Show>
            <Show when={props.state.status === "downloading"}>
                <PaperProgress value={props.state.percent ?? undefined} max={100} />
            </Show>
            <Show when={downloadError()}><PaperText role="alert" color="danger">{downloadError()}</PaperText></Show>
        </PaperFlex>
    </PaperModal>;
}
