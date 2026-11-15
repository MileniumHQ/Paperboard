// What the SDK's calls send, built once for its own modules and for
// invoke()'s callers alike. Internal: not part of the package's surface.
import { fetchRegistryIndex } from "../config";
import { debugErr } from "../debug";
import { errorMessage } from "../errors";
import type { ProcessStartOptions } from "../process";
import type { RpcParams } from "../protocol";

/** process:run's params from start's options: one shape for every start option. */
export function processRunParams<P extends Partial<Record<keyof ProcessStartOptions, unknown>>>(p: P): {
    id: P["id"];
    command: P["command"];
    args: NonNullable<P["args"]> | never[];
    cwd: P["cwd"];
    env: P["env"];
    stdin?: false;
    inputEncoding?: P["inputEncoding"];
    consoleInput?: true;
    important?: true;
} {
    return {
        id: p.id,
        command: p.command,
        args: p.args || [],
        cwd: p.cwd,
        env: p.env,
        ...(p.stdin === false ? { stdin: false } : {}),
        ...(p.inputEncoding ? { inputEncoding: p.inputEncoding } : {}),
        ...(p.consoleInput ? { consoleInput: true } : {}),
        ...(p.important ? { important: true } : {}),
    };
}

/** file:download's params from download's options. */
type DownloadFields = Partial<Record<"url" | "targetPath" | "appId" | "downloadId" | "sha1" | "sha256" | "checksum", unknown>>;
export function fileDownloadParams<P extends DownloadFields>(a: P): {
    url: P["url"];
    targetPath: P["targetPath"];
    appId: P["appId"];
    downloadId: P["downloadId"];
    options: { sha1: P["sha1"]; sha256: P["sha256"]; checksum: P["checksum"] };
} {
    return { url: a.url, targetPath: a.targetPath, appId: a.appId, downloadId: a.downloadId, options: { sha1: a.sha1, sha256: a.sha256, checksum: a.checksum } };
}

/**
 * panel:install's params: the daemon resolves the release from its own
 * registry; the index entry the library showed travels as what we expect,
 * so a release that changed in between refuses instead of installing
 * something the user did not pick.
 */
export async function panelInstallParams(panelId: string): Promise<RpcParams<"panel:install">> {
    try {
        const registryData = await fetchRegistryIndex();
        const record = registryData?.[panelId];
        if (!record) throw new Error(`the registry does not list "${panelId}"`);
        return {
            panelId,
            sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
            version: typeof record.version === "string" ? record.version : undefined,
        };
    } catch (err) {
        debugErr("panel-install registry lookup", err);
        throw new Error(`Install refused for "${panelId}": ${errorMessage(err) || "registry lookup failed"}`);
    }
}
