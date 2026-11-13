import { packageApi, type PackageProgress } from "./api";

/** how much of how much has downloaded, when the download says */
export interface DownloadedBytes {
    done: number;
    total: number;
}

export interface JavaInstallStages {
    onDownload?: (percent: number, bytes?: DownloadedBytes) => void;
    onExtract?: (percent: number) => void;
}

// Installs a Java runtime package when missing, reporting staged progress
// exactly like onboarding. Returns whether a download happened. Throws on
// failure; callers own their loader terminal states.
export async function ensureJavaRuntime(
    javaPkg: string,
    stages?: JavaInstallStages,
): Promise<{ downloaded: boolean }> {
    const present = await packageApi.isInstalled(javaPkg);
    if (present) return { downloaded: false };
    await packageApi.download(javaPkg, (progress: PackageProgress) => {
        if (progress.stage === "downloading") {
            const bytes = progress.bytesLoaded !== undefined && progress.bytesTotal
                ? { done: progress.bytesLoaded, total: progress.bytesTotal }
                : undefined;
            stages?.onDownload?.(progress.percent, bytes);
        } else if (progress.stage === "extracting") {
            stages?.onExtract?.(progress.percent);
        }
    });
    return { downloaded: true };
}
