export interface AppUpdateState {
    revision: number;
    status: "idle" | "checking" | "current" | "downloading" | "ready" | "failed" | "manual";
    installMode: "automatic" | "package-manager";
    version: string | null;
    percent: number | null;
    error: string | null;
}

export const initialAppUpdateState: AppUpdateState = {
    revision: 0, status: "idle", installMode: "automatic", version: null, percent: null, error: null,
};
