import { createEffect, createSignal } from "solid-js";
import type { LoaderStatus } from "@mileniumhq/paperui";
import { ACTION_IDS } from "../service/contract";
import type { InstallOutcome } from "../service/softwareInstall";
import { providerFor } from "../software/providers";
import { SOFTWARE_NAMES, getRequiredJavaVersion, type ServerSoftwareType } from "./software";
import { ensureJavaRuntime } from "./ensureJava";
import { installProgress, serverBridge, setInstallProgress } from "./server";
import type { InstallLoaderItem } from "../components/InstallLoaders";

type Row = { percent: () => number; setPercent: (v: number) => void; status: () => LoaderStatus; setStatus: (v: LoaderStatus) => void };

function row(): Row {
    const [percent, setPercent] = createSignal(0);
    const [status, setStatus] = createSignal<LoaderStatus>("waiting");
    return { percent, setPercent, status, setStatus };
}

/**
 * The install rows shared by onboarding and the Versions tab, and the one
 * way the UI installs a server: Java with staged progress here, then the
 * service's install-server-version action, whose download and installer
 * progress arrives through service state.
 */
export function createInstallRun() {
    const javaDownload = row();
    const javaExtract = row();
    const download = row();
    const installer = row();
    const [active, setActive] = createSignal(false);

    // map the service's published progress while this run owns it;
    // terminal failure stays with run()'s catch
    createEffect(() => {
        if (!active()) return;
        const progress = installProgress();
        if (!progress) return;
        switch (progress.stage) {
            case "downloading":
            case "verifying":
                download.setStatus("loading");
                download.setPercent(progress.percent);
                break;
            case "installing":
                download.setStatus("success");
                download.setPercent(100);
                installer.setStatus("indeterminate");
                break;
            case "completed":
                download.setStatus("success");
                download.setPercent(100);
                installer.setStatus("success");
                installer.setPercent(100);
                break;
        }
    });

    const reset = () => {
        javaDownload.setPercent(0);
        javaDownload.setStatus("loading");
        for (const r of [javaExtract, download, installer]) {
            r.setPercent(0);
            r.setStatus("waiting");
        }
    };

    const rows = (software: ServerSoftwareType): InstallLoaderItem[] => {
        const name = SOFTWARE_NAMES[software];
        const items: InstallLoaderItem[] = [
            { label: "Downloading Java...", percent: javaDownload.percent, status: javaDownload.status },
            { label: "Installing Java...", percent: javaExtract.percent, status: javaExtract.status },
            { label: `Downloading ${name}...`, percent: download.percent, status: download.status },
        ];
        if (providerFor(software).install.type === "installer") {
            items.push({ label: `Installing ${name}...`, percent: installer.percent, status: installer.status });
        }
        return items;
    };

    const run = async (software: ServerSoftwareType, version: string): Promise<InstallOutcome> => {
        const javaPkg = getRequiredJavaVersion(version);
        if (!javaPkg) throw new Error(`Could not determine the Java runtime for ${version}.`);
        reset();
        // clear a previous run's terminal state before the effect reads it
        setInstallProgress(null);
        setActive(true);
        try {
            try {
                await ensureJavaRuntime(javaPkg, {
                    onDownload: (percent) => {
                        javaDownload.setStatus("loading");
                        javaDownload.setPercent(percent);
                    },
                    onExtract: (percent) => {
                        javaDownload.setStatus("success");
                        javaDownload.setPercent(100);
                        javaExtract.setStatus("loading");
                        javaExtract.setPercent(percent);
                    },
                });
            } catch (err) {
                if (javaDownload.status() === "success") javaExtract.setStatus("error");
                else javaDownload.setStatus("error");
                throw err;
            }
            javaDownload.setStatus("success");
            javaDownload.setPercent(100);
            javaExtract.setStatus("success");
            javaExtract.setPercent(100);

            download.setStatus("loading");
            try {
                // a jar download plus a Forge or NeoForge installer outlasts the
                // bridge's 30 s default; the service's progress shows it is alive
                const outcome = await serverBridge.call<InstallOutcome>(
                    ACTION_IDS.installServerVersion,
                    { software, version },
                    { timeoutMs: null },
                );
                download.setStatus("success");
                download.setPercent(100);
                installer.setStatus("success");
                installer.setPercent(100);
                return outcome;
            } catch (err) {
                if (installer.status() === "indeterminate") installer.setStatus("error");
                else download.setStatus("error");
                throw err;
            }
        } finally {
            setActive(false);
        }
    };

    return { rows, run };
}
