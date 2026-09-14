import { packageApi, type PackageProgress } from "@paperboard-dev/paperapi";

export interface JavaInstallStages {
    onDownload?: (percent: number) => void;
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
            stages?.onDownload?.(progress.percent);
        } else if (progress.stage === "extracting") {
            stages?.onExtract?.(progress.percent);
        }
    });
    return { downloaded: true };
}
