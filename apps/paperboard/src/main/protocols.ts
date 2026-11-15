// The window's two schemes: paperboard://shell serves the packaged shell
// (shellAssets.ts) and panel://<computerId>.<panelId>/<path> serves panel
// documents, with the same serving as the browser-mode host (panelServe.ts).
import { protocol } from "electron";
import { parsePanelHost, servePanelAsset } from "./panelServe";
import { readShellFile, SHELL_HOST, SHELL_SCHEME } from "./shellAssets";

// before the app is ready
export function registerAppSchemes(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: SHELL_SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                codeCache: true,
            },
        },
        {
            scheme: "panel",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                codeCache: true,
                stream: true,
            },
        },
    ]);
}

export function handleAppProtocols(rendererDir: string): void {
    protocol.handle("panel", async (request: Request) => {
        const url = new URL(request.url);
        const scope = parsePanelHost(url.hostname);
        if (!scope) return new Response("Malformed panel URL: missing computer scope prefix", { status: 400 });
        return servePanelAsset(scope.comp, scope.panelId, url.pathname);
    });
    protocol.handle(SHELL_SCHEME, async (request: Request) => {
        const url = new URL(request.url);
        if (url.host !== SHELL_HOST) return new Response("Not found", { status: 404 });
        const file = await readShellFile(rendererDir, url.pathname);
        if (!file.ok) return new Response(null, { status: file.status });
        return new Response(new Uint8Array(file.data), { headers: file.headers });
    });
}
