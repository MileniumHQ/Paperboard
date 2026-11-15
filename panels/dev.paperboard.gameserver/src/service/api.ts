// Service-only adapters: asynchronous work and process callbacks retain the
// server that started them. No renderer selection participates in this scope.
export * from "@mileniumhq/paperapi";
import {
    config as rawConfig,
    fileApi as rawFiles,
    processApi as rawProcess,
    portApi as rawPorts,
} from "@mileniumhq/paperapi";
import { scopedFiles } from "../scopedFiles";
import { currentServer, inServer } from "./scope";
import { PANEL_ID } from "./contract";
export const files = scopedFiles(rawFiles, () => currentServer()?.stored.directory ?? "");
export const fileApi = files;
export const config: typeof rawConfig = {
    ...rawConfig,
    get: async <T>(...args: Parameters<typeof rawConfig.get>): Promise<T> => {
        const server = currentServer();
        return server ? (server.settings as T) : rawConfig.get<T>(...args);
    },
    set: async (...args: Parameters<typeof rawConfig.set>) => {
        // a whole-object write would drop what another module saved meanwhile
        if (currentServer()) throw new Error("A server's settings change through updateSettings");
        return rawConfig.set(...args);
    },
};
type Settings = Record<string, unknown>;
/** The current server's saved settings. */
export const readSettings = async (): Promise<Settings> => (await config.get<Settings | null>(PANEL_ID)) ?? {};
export async function updateSettings(change: Settings | ((current: Settings) => Settings)): Promise<Settings> {
    const server = currentServer();
    if (server) return server.updateSettings(change);
    const apply = typeof change === "function" ? change : (current: Settings) => ({ ...current, ...change });
    const next = apply((await rawConfig.get<Settings | null>(PANEL_ID)) ?? {});
    await rawConfig.set(next, PANEL_ID);
    return next;
}
export const processApi = new Proxy(rawProcess, {
    get(target, key: keyof typeof rawProcess) {
        return (...args: any[]) => {
            const server = currentServer();
            if (!server) return (target[key] as Function).apply(target, args);
            args = args.map((arg) => (typeof arg === "function" ? (...values: any[]) => inServer(server, () => arg(...values)) : arg));
            return (server.process[key] as Function).apply(server.process, args);
        };
    },
});
export const portApi: typeof rawPorts = {
    ...rawPorts,
    claim: (panel, request) => {
        const server = currentServer();
        return server ? server.ports.claim(request) : rawPorts.claim(panel, request);
    },
    prepare: (panel, name) => {
        const server = currentServer();
        return server ? server.ports.prepare(name) : rawPorts.prepare(panel, name);
    },
    release: (panel, name) => {
        const server = currentServer();
        return server ? server.ports.release(name) : rawPorts.release(panel, name);
    },
};
