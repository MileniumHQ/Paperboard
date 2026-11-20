import * as os from "os";
import { computerHostname } from "../server/hostname";
import { getDetailedOsInfo } from "../system/osInfo";
import { getNetworkIp } from "../core/util";
import { PAPERCRANE_VERSION } from "../system/discovery";
import { logger } from "../core/logger";
import type { RpcContext } from "./context";
import { forbidden, Refusal } from "./errors";
import { rpcModule } from "./dispatch";
import { getGpuReport } from "../system/gpu";
import { usageSampler, type UsageRoots } from "../system/usage";
import { requireReleaseOrder } from "../packages/releasePolicy";
import { installCraneRelease, confirmCraneUpdate } from "../packages/craneUpdate";
import { daemonReleaseKey } from "@mileniumhq/release";

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
        logger.warn("[system:update] refusing unparseable download URL:", err);
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

// pairing a new computer, for `papercrane pair` on a daemon that has no
// interactive screen. Minting a host credential is host equipment: a panel
// token never opens it.
function pairing(ctx: RpcContext, action: string): RpcContext["auth"] {
    if (ctx.callerPanelId()) throw forbidden(`${action} is host-only`);
    if (ctx.auth.noAuth) throw forbidden("Pairing is off: this daemon runs with --no-auth");
    return ctx.auth;
}

export const systemRpc = rpcModule({
    "system:ip": async () => ({ ip: await getNetworkIp() }),
    "system:info": async (_, ctx) => {
        const [osInfo, ip] = await Promise.all([getDetailedOsInfo(), getNetworkIp()]);
        if (ctx.callerPanelId() === null) await confirmCraneUpdate(process.execPath, PAPERCRANE_VERSION);
        return {
            service: "papercrane",
            version: PAPERCRANE_VERSION,
            hostname: computerHostname(),
            os: osInfo.os,
            osVersion: osInfo.osVersion,
            distroId: osInfo.distroId,
            distroName: osInfo.distroName,
            arch: process.arch,
            ip,
            username: process.env.USER || os.userInfo().username,
        };
    },
    "system:gpus": () => getGpuReport(),
    // who uses this computer, panel by panel: host equipment for Home, not
    // something one panel's token reads about the others
    "system:usage": (_, ctx) => {
        if (ctx.callerPanelId()) throw forbidden("system:usage is host-only");
        return usageSampler.sample(() => usageRoots(ctx));
    },
    "system:pairing-start": (_, ctx, action) => ({ code: pairing(ctx, action).startPairing() }),
    "system:pairing-cancel": (_, ctx, action) => {
        const auth = pairing(ctx, action);
        const wasActive = auth.isPairingActive();
        if (wasActive) auth.cancelPairing();
        return { cancelled: wasActive };
    },
    "system:pairing-status": (_, ctx, action) => {
        const auth = pairing(ctx, action);
        return {
            active: auth.isPairingActive(),
            computers: auth.getAuthorizedClients()
                .filter((c) => c.clientName !== "host" && !c.panelId)
                .map((c) => ({ name: c.clientName, pairedAt: c.pairedAt })),
        };
    },
    "system:update": async ({ downloadUrl, sha256, version, signature }, ctx) => {
        // replacing the daemon binary is host equipment, never panel
        // equipment: a scoped pcp_ token carries one panel claim and no
        // wider reach. Caller identity is the token claim, not a param.
        if (ctx.callerPanelId()) {
            logger.warn(`[system] scoped token claim "${ctx.callerPanelId()}" refused system:update`);
            throw forbidden("system:update is host-only; scoped panel tokens may not self-update the daemon");
        }
        // The URL and sha256 come from the caller; the authority for which
        // bytes are a Paperboard Server release is the offline release key.
        // A signature over (version, sha256) is required, and the version
        // must be newer than this daemon: an old signed binary cannot be
        // replayed as a downgrade.
        if (!downloadUrl || !isSafeUpdateUrl(downloadUrl)) {
            throw new Refusal("Refusing update: download URL must be https (or http to localhost)");
        }
        // checksum refusal happens BEFORE any network is touched and
        // before the client is told the update started
        if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Refusal("Refusing update: sha256 checksum is required");
        // platform capability is refused before release facts are checked:
        // a daemon that cannot swap its own binary refuses whatever the
        // caller signs. No in-place swap over a running executable on Windows.
        if (process.platform === "win32") throw new Refusal("Self-update is not supported on Windows yet");
        if (process.versions.electron) {
            // embedded daemon: "the crane binary" IS the running Electron
            // executable, which electron-updater owns. Swapping it here
            // would replace the app beneath its own updater — the respawn
            // guard below is not enough, the rename must never happen either.
            throw new Refusal("Self-update is not supported when the daemon runs embedded in Electron");
        }
        if (!version || /[\n\r]/.test(version)) throw new Refusal("Refusing update: the release version is required");
        try {
            requireReleaseOrder({ version }, [{ version: PAPERCRANE_VERSION }], { requireNewer: true });
        } catch {
            throw new Refusal(`Refusing update: ${version} is not newer than the running ${PAPERCRANE_VERSION}`);
        }
        const outcome = await installCraneRelease({ downloadUrl, sha256, version, signature, execPath: process.execPath, releaseKey: daemonReleaseKey() });
        // Saved, not activated. Starting a replacement before this daemon
        // releases its listener races index.ts's stale-instance takeover.
        // A restart supervisor must observe old exit and new authenticated
        // readiness; until that exists, keep this daemon running and retain
        // exactly one parked executable for recovery. The next generation's
        // authenticated system:info removes it after version confirmation.
        return {
            accepted: true,
            status: outcome.status,
            restartRequired: true,
            message: "Verified daemon replacement saved; restart the daemon to activate it",
        };
    },
}, "System operation failed");
