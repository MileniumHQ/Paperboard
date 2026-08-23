import { invoke } from "./ipc";

// Resolves current panel host identifier
const getHost = () => (typeof window !== "undefined" ? window.location?.hostname : "");

// Panel configuration persistence API
export const config = {
    get: <T = any>(id?: string): Promise<T> => invoke("config-get", id || getHost()),
    set: (data: any, id?: string): Promise<void> => invoke("config-set", { id: id || getHost(), data }),
};

export const configApi = config;
