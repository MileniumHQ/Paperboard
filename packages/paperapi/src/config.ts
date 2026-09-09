import { invokeIn, getPanelId } from "./ipc";

// registry base URL, override with ORIGAMI_REGISTRY_URL
export const REGISTRY_URL: string =
    (typeof process !== "undefined" && process.env?.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";

const getHost = () => getPanelId();

// panel configuration persistence, scope omitted = ambient
export const config = {
    get: <T = any>(id?: string, scope?: string): Promise<T> =>
        invokeIn<T>(scope, "config-get", id || getHost()),
    set: (data: any, id?: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "config-set", { id: id || getHost(), data }),
};

export const configApi = config;
