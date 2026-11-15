// Service-only adapters: asynchronous work and process callbacks retain the
// server that started them. No renderer selection participates in this scope.
export * from "@mileniumhq/paperapi";
import {
    config as rawConfig,
    fileApi as rawFiles,
    processApi as rawProcess,
    portApi as rawPorts,
} from "@mileniumhq/paperapi";
import { serverPortLabel, serverPortName } from "../core/portNames";
import { scopedFiles } from "../scopedFiles";
import { currentServer, inServer } from "./scope";
import { PANEL_ID } from "./contract";
export const files = scopedFiles(rawFiles, () => currentServer()?.server.directory ?? "");
export const fileApi = files;
export const config: typeof rawConfig = {
    ...rawConfig,
    get: async <T>(...args: Parameters<typeof rawConfig.get>): Promise<T> => {
        const scope = currentServer();
        return scope ? (scope.server.settings as T) : rawConfig.get<T>(...args);
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
/**
 * The one way a server's settings change: a patch merges over them, a
 * function maps them, applied in order against the latest saved copy so
 * two writers never drop each other's keys. Gives what was saved.
 */
export async function updateSettings(change: Settings | ((current: Settings) => Settings)): Promise<Settings> {
    const apply = typeof change === "function" ? change : (current: Settings) => ({ ...current, ...change });
    const scope = currentServer();
    if (scope) return scope.updateSettings(apply);
    const next = apply((await rawConfig.get<Settings | null>(PANEL_ID)) ?? {});
    await rawConfig.set(next, PANEL_ID);
    return next;
}
export const processApi = new Proxy(rawProcess, {
    get(target, key: keyof typeof rawProcess) {
        return (...args: any[]) => {
            const scope = currentServer();
            if (scope) {
                if (
                    typeof args[0] === "string" &&
                    scope.processIds.includes(args[0]) &&
                    !scope.legacy
                )
                    args[0] = `${scope.server.id}-${args[0]}`;
                if (
                    args[0] &&
                    typeof args[0] === "object" &&
                    scope.processIds.includes(args[0].id) &&
                    !scope.legacy
                )
                    args[0] = { ...args[0], id: `${scope.server.id}-${args[0].id}` };
                args = args.map((arg) =>
                    typeof arg === "function"
                        ? (...values: any[]) => inServer(scope, () => arg(...values))
                        : arg,
                );
            }
            return (target[key] as Function).apply(target, args);
        };
    },
});
export const portApi: typeof rawPorts = {
    ...rawPorts,
    claim: (panel, request) => {
        const scope = currentServer();
        return rawPorts.claim(
            panel,
            scope
                ? {
                      ...request,
                      name: portName(request.name),
                      label: serverPortLabel(scope.server.name, request.label),
                  }
                : request,
        );
    },
    prepare: (panel, name) => rawPorts.prepare(panel, portName(name)),
    release: (panel, name) => rawPorts.release(panel, portName(name)),
};
function portName(name: string): string {
    const scope = currentServer();
    return scope ? serverPortName(scope.server.id, scope.legacy, name) : name;
}
