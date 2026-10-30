import { createSignal } from "solid-js";
import type { LoaderStatus } from "@mileniumhq/paperui";
import type { InstallLoaderItem } from "../../components/InstallLoaders";
import { installProgress, serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";

/**
 * A Terraria install as Setup and Versions show it: the download reports its
 * own progress, unpacking follows it. run() resolves true once installed.
 */
export function createTerrariaInstall() {
    const [error, setError] = createSignal("");
    const [installed, setInstalled] = createSignal(false);
    const [running, setRunning] = createSignal(false);

    const run = async (version: string): Promise<boolean> => {
        setError("");
        setInstalled(false);
        setRunning(true);
        try {
            await serverBridge.call("terraria-install", { version }, { timeoutMs: null });
            setInstalled(true);
            return true;
        } catch (err) {
            setError(errorMessage(err));
            return false;
        } finally {
            setRunning(false);
        }
    };

    const stage = () => installProgress()?.stage;
    const downloaded = () => installed() || stage() === "completed";
    const downloadStatus = (): LoaderStatus =>
        error() && !downloaded() ? "error" : downloaded() ? "success" : stage() ? "loading" : "waiting";
    const setupStatus = (): LoaderStatus =>
        error() && downloaded() ? "error" : installed() ? "success" : downloaded() ? "indeterminate" : "waiting";

    const rows = (version: string): InstallLoaderItem[] => [
        { label: `Downloading Terraria ${version}...`, percent: () => (downloaded() ? 100 : installProgress()?.percent ?? 0), status: downloadStatus },
        { label: "Setting up server...", percent: () => (installed() ? 100 : 0), status: setupStatus },
    ];

    return { error, installed, running, run, rows, reset: () => setError("") };
}
