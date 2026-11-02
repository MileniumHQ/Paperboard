import { createEffect, createSignal } from "solid-js";
import type { LoaderStatus } from "@mileniumhq/paperui";
import type { InstallLoaderItem } from "../../components/InstallLoaders";
import { installProgress, serverBridge } from "../../lib/server";
import { createInstallFlow } from "../installFlow";
import type { SteamUpdateStatus } from "./installAction";
export type { SteamUpdateStatus };

/** What a Steam game's install action reports; the setup and Versions screens read it. */
export interface SteamInstallInfo {
    host: { supported: boolean; reason?: string };
    /** Steam's build of the installed server; null before an install */
    build: string | null;
    /** the game's own version, once a start has printed it */
    version: string | null;
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
            setReached(-1);
            await serverBridge.call(action, undefined, { timeoutMs: null });
        });

    // the furthest step reached; a failure keeps it, so the failed row is the one shown failing
    const ORDER = ["downloading", "verifying", "installing", "completed"];
    const [reached, setReached] = createSignal(-1);
    createEffect(() => {
        const at = ORDER.indexOf(installProgress()?.stage ?? "");
        if (at > reached()) setReached(at);
    });
    const current = () => Math.max(0, reached());
    const percent = (step: number) => () => (installed() || reached() > step ? 100 : reached() === step && step < 2 ? installProgress()?.percent ?? 0 : 0);
    const status = (step: number) => (): LoaderStatus => {
        if (installed() || reached() > step) return "success";
        if (current() !== step) return "waiting";
        if (error()) return "error";
        if (!running()) return "waiting";
        return step === 2 ? "indeterminate" : "loading";
    };

    const rows = (name: string): InstallLoaderItem[] => [
        { label: `Downloading ${name} from Steam...`, percent: percent(0), status: status(0) },
        { label: "Checking the downloaded files...", percent: percent(1), status: status(1) },
        { label: "Setting up server...", percent: percent(2), status: status(2) },
    ];

    return { error, installed, running, run, rows, reset: flow.reset };
}
