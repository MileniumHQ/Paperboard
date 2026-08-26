import { invokeIn, getPanelId } from "./ipc";

// Panel registry base URL. Override with the ORIGAMI_REGISTRY_URL env var.
export const REGISTRY_URL: string =
    (typeof process !== "undefined" && process.env?.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";

// Resolves current panel id (hostname minus the computer scope prefix)
const getHost = () => getPanelId();

// Panel configuration persistence API; scope omitted = ambient
export const config = {
    get: <T = any>(id?: string, scope?: string): Promise<T> =>
        invokeIn<T>(scope, "config-get", id || getHost()),
    set: (data: any, id?: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "config-set", { id: id || getHost(), data }),
};

export const configApi = config;
