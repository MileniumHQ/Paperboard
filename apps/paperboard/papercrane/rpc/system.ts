import * as os from "os";
import { computerHostname } from "../hostname";
import { getDetailedOsInfo, getNetworkIp } from "../index";
import { PAPERCRANE_VERSION } from "../discovery";
import { logger } from "../logger";
import type { RpcContext } from "./context";
import { rpcErrorCode } from "./params";
import { forbidden } from "./errors";
import { getGpuReport } from "../gpu";
import { usageSampler, type UsageRoots } from "../usage";
import { requireReleaseOrder } from "../releasePolicy";
import { installCraneRelease, confirmCraneUpdate } from "../craneUpdate";

// self-update URL must be https or loopback http
function isSafeUpdateUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol === "https:") return true;
        if (url.protocol === "http:") {
            return (
                url.hostname === "localhost" ||
                url.hostname === "127.0.0.1" ||
                url.hostname === "[::1]"
            );
        }
        return false;
    } catch (err) {
        // malformed URL fails closed (deny) — logged so update refusals
        // stay diagnosable instead of mysterious
        console.error("[system:update] refusing unparseable download URL:", err);
        return false;
    }
}

function usageRoots(ctx: RpcContext): UsageRoots {
    const panels = new Map<string, number[]>();
    const add = (owner: string, pid: number) => {
        const list = panels.get(owner);
        if (list) list.push(pid);
        else panels.set(owner, [pid]);
    };
    for (const { panelId, pid } of ctx.engine.serviceRoots()) add(panelId, pid);
    const paperboard = [process.pid];
    for (const { owner, pid } of ctx.engine.workloadRoots()) {
        if (owner) add(owner, pid);
        else paperboard.push(pid);
    }
    return { paperboard, panels };
}

export async function handleSystem(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { reply } = ctx;
    try {
        switch (action) {
        case "system:ip": {
            reply(id, { ip: getNetworkIp() });
            return true;
        }
        case "system:info": {
            const osInfo = await getDetailedOsInfo();
            if (ctx.callerPanelId() === null) await confirmCraneUpdate(process.execPath, PAPERCRANE_VERSION);
            reply(id, {
                service: "papercrane",
                version: PAPERCRANE_VERSION,
                hostname: computerHostname(),
                os: osInfo.os,
                osVersion: osInfo.osVersion,
                distroId: osInfo.distroId,
                distroName: osInfo.distroName,
                arch: process.arch,
                ip: getNetworkIp(),
                username: process.env.USER || os.userInfo().username,
            });
            return true;
        }
        case "system:gpus": {
            reply(id, await getGpuReport());
            return true;
        }
        case "system:usage": {
            // who uses this computer, panel by panel: host equipment for
            // Home, not something one panel's token reads about the others
            if (ctx.callerPanelId()) throw forbidden("system:usage is host-only");
            reply(id, await usageSampler.sample(() => usageRoots(ctx)));
            return true;
        }
        case "system:update": {
            const { downloadUrl, sha256, version, signature } = params ?? {};
            // replacing the daemon binary is host equipment, never panel
            // equipment: a scoped pcp_ token carries one panel claim and no
            // wider reach. Caller identity is the token claim, not a param.
            if (ctx.callerPanelId()) {
                logger.warn(
                    `[system] scoped token claim "${ctx.callerPanelId()}" refused system:update`,
                );
                throw forbidden("system:update is host-only; scoped panel tokens may not self-update the daemon");
            }
            // The URL and sha256 come from the caller; the authority for
            // which bytes are a Paperboard Server release is the offline
            // release key. A signature over (version, sha256) is required,
            // and the version must be newer than this daemon: an old signed
            // binary cannot be replayed as a downgrade.
            if (!downloadUrl || !isSafeUpdateUrl(downloadUrl)) {
                reply(id, null, "Refusing update: download URL must be https (or http to localhost)");
                return true;
            }
            // checksum refusal happens BEFORE any network is touched and
            // before the client is told the update started
            if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256)) {
                reply(id, null, "Refusing update: sha256 checksum is required");
                return true;
            }
            // platform capability is refused before release facts are
            // checked: a daemon that cannot swap its own binary refuses
            // whatever the caller signs
            if (process.platform === "win32") {
                // no in-place swap over a running executable on Windows
                reply(id, null, "Self-update is not supported on Windows yet");
                return true;
            }
            if (process.versions.electron) {
                // embedded daemon: "the crane binary" IS the running
                // Electron executable, which electron-updater owns. Swapping
                // it here would replace the app beneath its own updater —
                // the respawn guard below is not enough, the rename must
                // never happen either.
                reply(id, null, "Self-update is not supported when the daemon runs embedded in Electron");
                return true;
            }
            if (typeof version !== "string" || !version || /[\n\r]/.test(version)) {
                reply(id, null, "Refusing update: the release version is required");
                return true;
            }
            try {
                requireReleaseOrder({ version }, [{ version: PAPERCRANE_VERSION }], { requireNewer: true });
            } catch (err) {
                reply(id, null, `Refusing update: ${version} is not newer than the running ${PAPERCRANE_VERSION}`);
                return true;
            }
            const outcome = await installCraneRelease({ downloadUrl, sha256, version, signature, execPath: process.execPath });
            // Saved, not activated. Starting a replacement before this daemon
            // releases its listener races index.ts's stale-instance takeover.
            // A restart supervisor must observe old exit and new authenticated
            // readiness; until that exists, keep this daemon running and retain
            // exactly one parked executable for recovery. The next generation's
            // authenticated system:info removes it after version confirmation.
            reply(id, { accepted: true, status: outcome.status, restartRequired: true,
                message: "Verified daemon replacement saved; restart the daemon to activate it" });
            return true;
        }
        default:
            return false;
        }
    } catch (err: any) {
        // codes travel on the error (RpcError, InvalidParams) — see rpc/errors.ts
        reply(id, null, err?.message || "System operation failed", rpcErrorCode(err));
        return true;
    }
}
