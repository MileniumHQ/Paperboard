import { createSignal } from "solid-js";
import type { LoaderStatus } from "@mileniumhq/paperui";
import type { InstallLoaderItem } from "../../components/InstallLoaders";
import { installProgress, serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { ensureJavaRuntime } from "../../lib/ensureJava";
import { softwareName, tmodloaderReleaseFor, type TerrariaSoftware } from "./catalog";

/**
 * A Terraria install as Setup and Versions show it: tModLoader first gets the
 * .NET runtime it runs on, then the download reports its own progress and
 * unpacking follows it. run() resolves true once installed.
 */
export function createTerrariaInstall() {
    const [error, setError] = createSignal("");
    const [installed, setInstalled] = createSignal(false);
    const [running, setRunning] = createSignal(false);
    const [runtimePercent, setRuntimePercent] = createSignal(0);
    const [runtimeReady, setRuntimeReady] = createSignal(false);

    const run = async (software: TerrariaSoftware, version: string): Promise<boolean> => {
        setError("");
        setInstalled(false);
        setRuntimeReady(false);
        setRuntimePercent(0);
        setRunning(true);
        try {
            if (software === "tmodloader") {
                // the same package ensure Minecraft's Java uses: download, then unpack
                await ensureJavaRuntime(tmodloaderReleaseFor(version).runtime, {
                    onDownload: (percent) => setRuntimePercent(percent * 0.9),
                    onExtract: (percent) => setRuntimePercent(90 + percent * 0.1),
                });
                setRuntimeReady(true);
            }
            await serverBridge.call("terraria-install", { software, version }, { timeoutMs: null });
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
    const runtimeStatus = (): LoaderStatus =>
        runtimeReady() ? "success" : error() ? "error" : running() ? "loading" : "waiting";
    const downloadStatus = (software: TerrariaSoftware) => (): LoaderStatus => {
        if (software === "tmodloader" && !runtimeReady()) return "waiting";
        return error() && !downloaded() ? "error" : downloaded() ? "success" : stage() ? "loading" : "waiting";
    };
    const setupStatus = (): LoaderStatus =>
        error() && downloaded() ? "error" : installed() ? "success" : downloaded() ? "indeterminate" : "waiting";

    const rows = (software: TerrariaSoftware, version: string): InstallLoaderItem[] => [
        ...(software === "tmodloader"
            ? [{ label: `Installing the .NET ${tmodloaderReleaseFor(version).runtime.replace(/^dotnet-/, "")} runtime...`, percent: () => (runtimeReady() ? 100 : runtimePercent()), status: runtimeStatus }]
            : []),
        {
            label: `Downloading ${software === "tmodloader" ? softwareName(software) : "Terraria"} ${version}...`,
            percent: () => (downloaded() ? 100 : installProgress()?.percent ?? 0),
            status: downloadStatus(software),
        },
        { label: "Setting up server...", percent: () => (installed() ? 100 : 0), status: setupStatus },
    ];

    return { error, installed, running, run, rows, reset: () => setError("") };
}
