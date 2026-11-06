import { createEffect, createSignal } from "solid-js";
import type { LoaderStatus } from "@mileniumhq/paperui";
import type { InstallLoaderItem } from "../../components/InstallLoaders";
import { installProgress, serverBridge, setInstallProgress } from "../../lib/server";
import { createInstallFlow } from "../installFlow";
import { formatSize } from "../../lib/addons/presentation";
import type { SteamUpdateStatus } from "./installAction";
export type { SteamUpdateStatus };

/** What a Steam game's install action reports; the setup and Versions screens read it. */
export interface SteamInstallInfo {
    host: { supported: boolean; reason?: string };
    /** Steam's build of the installed server; null before an install */
    build: string | null;
    /** the game's own version, once a start has printed it */
    version: string | null;
    /** whether this server's download finished, so setup opened again does not download it again */
    downloaded: boolean;
}

/**
 * A Steam dedicated server install as Setup and Versions show it: SteamCMD
 * downloads, then checks the files, then the game's service sets the server
 * up. run() resolves true once installed.
 */
export function createSteamInstall(action: string) {
    const flow = createInstallFlow();
    const { error, installed, running } = flow;

    const run = (): Promise<boolean> =>
        flow.run(async () => {
            // a previous run's last stage is not this run's: an install already running reports its own
            setInstallProgress(null);
            setReached(-1);
            await serverBridge.call(action, undefined, { timeoutMs: null });
        });

    // the row each stage belongs to; getting ready to download is the download's row
    const ROW: Record<string, number> = { preparing: 0, downloading: 0, verifying: 1, installing: 2, completed: 3 };
    // the furthest step reached; a failure keeps it, so the failed row is the one shown failing
    const [reached, setReached] = createSignal(-1);
    createEffect(() => {
        const at = ROW[installProgress()?.stage ?? ""] ?? -1;
        if (at > reached()) setReached(at);
    });
    const current = () => Math.max(0, reached());
    /** the row's own progress, while it is the one running */
    const live = (step: number) => {
        const progress = installProgress();
        return progress && ROW[progress.stage] === step && reached() === step ? progress : undefined;
    };
    const percent = (step: number) => () => (installed() || reached() > step ? 100 : step < 2 ? live(step)?.percent ?? 0 : 0);
    const status = (step: number) => (): LoaderStatus => {
        if (installed() || reached() > step) return "success";
        if (current() !== step) return "waiting";
        if (error()) return "error";
        if (!running()) return "waiting";
        // nothing measured yet (SteamCMD starting, room being made): it spins instead of sitting at nothing
        if (step === 2 || !live(step) || live(step)!.stage === "preparing") return "indeterminate";
        return "loading";
    };
    const amount = (step: number) => () => {
        const bytes = live(step)?.stage === "preparing" ? undefined : live(step)?.bytes;
        return bytes && bytes.done > 0 && bytes.total > 0 ? `${formatSize(bytes.done)} of ${formatSize(bytes.total)}` : undefined;
    };

    const rows = (name: string): InstallLoaderItem[] => [
        { label: `Downloading ${name} from Steam...`, detail: amount(0), percent: percent(0), status: status(0) },
        { label: "Checking the downloaded files...", detail: amount(1), percent: percent(1), status: status(1) },
        { label: "Setting up server...", percent: percent(2), status: status(2) },
    ];

    return { error, installed, running, run, rows, reset: flow.reset, finished: flow.finished };
}
