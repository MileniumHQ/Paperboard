import { invokeIn } from "./ipc";

// Resolves current panel host identifier
const getHost = () => (typeof window !== "undefined" ? window.location?.hostname : "");

// Panel configuration persistence API. The optional `scope` names the target
// computer; omitted means the ambient scope (panel bootstrap param / local).
// Note: the special "app-settings" config id is always host-local by design.
export const config = {
    get: <T = any>(id?: string, scope?: string): Promise<T> =>
        invokeIn<T>(scope, "config-get", id || getHost()),
    set: (data: any, id?: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "config-set", { id: id || getHost(), data }),
};

export const configApi = config;
