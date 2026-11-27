import type { LoaderStatus } from "@mileniumhq/paperui";
import type { InstallLoaderItem } from "../../components/InstallLoaders";
import { useServer } from "../../lib/server";
import { createInstallFlow } from "../installFlow";

/**
 * A Factorio install as setup and Versions show it: the download reports its
 * own progress, and unpacking follows it. run() resolves true once installed.
 */
export function createFactorioInstall() {
    const { calls, installProgress, patch } = useServer();
    const flow = createInstallFlow();
    const { error, installed, running } = flow;

    const run = (): Promise<boolean> =>
        flow.run(async () => {
            // a previous install's last stage is not this one's: the rows wait until the service starts this one
            patch({ installProgress: null });
            await calls.factorioInstall();
        });

    const stage = () => installProgress()?.stage;
    const downloaded = () => installed() || stage() === "installing" || stage() === "completed";
    const downloadStatus = (): LoaderStatus => (error() && !downloaded() ? "error" : downloaded() ? "success" : stage() ? "loading" : "waiting");
    const setupStatus = (): LoaderStatus => (error() && downloaded() ? "error" : installed() ? "success" : downloaded() ? "indeterminate" : "waiting");

    const rows = (version: string): InstallLoaderItem[] => [
        {
            label: `Downloading Factorio ${version}`,
            done: `Downloaded Factorio ${version}`,
            percent: () => (downloaded() ? 100 : installProgress()?.percent ?? 0),
            bytes: () => (downloadStatus() === "loading" && stage() === "downloading" ? installProgress()?.bytes : undefined),
            status: downloadStatus,
        },
        { label: "Setting up the server", done: "Set up the server", percent: () => (installed() ? 100 : 0), status: setupStatus },
    ];

    return { error, installed, running, run, rows, finished: flow.finished, reset: flow.reset };
}
