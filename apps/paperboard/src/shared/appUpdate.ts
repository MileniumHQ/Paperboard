export interface AppUpdateState {
    revision: number;
    status: "idle" | "checking" | "current" | "downloading" | "ready" | "failed" | "manual";
    // package-download: a deb or rpm from Paperboard; the user installs the new one
    // package-manager: another package manager owns the install, which updates through it
    // administrator: an MSI; whoever deployed it installs the new one
    installMode: "automatic" | "package-manager" | "package-download" | "administrator";
    version: string | null;
    percent: number | null;
    error: string | null;
}

export const initialAppUpdateState: AppUpdateState = {
    revision: 0, status: "idle", installMode: "automatic", version: null, percent: null, error: null,
};
