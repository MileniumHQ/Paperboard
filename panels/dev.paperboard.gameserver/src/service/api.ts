// Service-only adapters: asynchronous work and process callbacks retain the
// server that started them. No renderer selection participates in this scope.
export * from "@mileniumhq/paperapi";
import {
    config as rawConfig,
    fileApi as rawFiles,
    processApi as rawProcess,
    actionsApi as rawActions,
    portApi as rawPorts,
} from "@mileniumhq/paperapi";
import { serverPortLabel, serverPortName } from "../core/portNames";
import { scopedFiles } from "../scopedFiles";
import { currentServer, inServer } from "./scope";
export const files = scopedFiles(rawFiles, () => currentServer()?.server.directory ?? "");
export const fileApi = files;
export const config: typeof rawConfig = {
    ...rawConfig,
    get: async <T>(...args: Parameters<typeof rawConfig.get>): Promise<T> => {
        const scope = currentServer();
        return scope ? (scope.server.settings as T) : rawConfig.get<T>(...args);
    },
    set: async (...args: Parameters<typeof rawConfig.set>) => {
        const scope = currentServer();
        if (!scope) return rawConfig.set(...args);
        await scope.saveSettings(args[0] as Record<string, unknown>);
    },
};
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
export const actionsApi: typeof rawActions = {
    ...rawActions,
    register: async (...args: Parameters<typeof rawActions.register>) => {
        const scope = currentServer();
        if (!scope) return rawActions.register(...args);
        if (scope.removing) throw new Error("The server is being removed");
        if (!scope.project) throw new Error("This server's Actions project is not ready");
        await scope.project.register(scope.bindAction(args[0]));
        if (scope.legacy)
            await rawActions.register(
                { ...scope.bindAction(args[0]), deprecated: LEGACY_DEPRECATION },
                undefined,
                args[2],
            );
    },
};
export const LEGACY_DEPRECATION =
    "Choose this server's action from its project in Actions. Old actions will be removed after v0.5.";
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
