import * as os from "os";
import * as fs from "fs";
import { spawn } from "child_process";
import { getDetailedOsInfo, getNetworkIp } from "../index";
import { streamToFileWithProgress } from "../storage";
import pkg from "../../package.json";
import { logger } from "../logger";
import type { RpcContext } from "./context";
import { rpcErrorCode } from "./params";
import { forbidden } from "./errors";

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
            reply(id, {
                service: "papercrane",
                version: pkg.version || "1.0.0",
                hostname: os.hostname().replace(/\.local$/i, ""),
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
        case "system:update": {
            const { downloadUrl, sha256 } = params;
            // replacing the daemon binary is host equipment, never panel
            // equipment: a scoped pcp_ token carries one panel claim and no
            // wider reach. Caller identity is the token claim, not a param.
            if (ctx.callerPanelId()) {
                logger.warn(
                    `[system] scoped token claim "${ctx.callerPanelId()}" refused system:update`,
                );
                throw forbidden("system:update is host-only; scoped panel tokens may not self-update the daemon");
            }
            // DOCUMENTED EXCEPTION to "separate trust decisions": the URL
            // and the sha256 arrive in the same params object, from the
            // same caller. That is inherent to a self-hosted updater — the
            // machine is told where its next binary lives, and there is no
            // second authority to cross-check against. The facts are still
            // validated independently (URL scheme/loopback here, checksum
            // format here, bytes verified against the sha after download),
            // the RPC is host-token-only, and the gap is recorded in
            // known-vulnerabilities.md. Do not "fix" this by mirroring the
            // registry rule — the updater has no registry to ask.
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
            reply(id, { success: true, message: "Update initiated" });
            setTimeout(async () => {
                const tmpPath = `${process.execPath}.tmp-${Date.now()}`;
                try {
                    // single path for downloads: 2GB cap + stall timeout +
                    // sha256 verification, same machinery as panels/packages
                    await streamToFileWithProgress(
                        downloadUrl,
                        tmpPath,
                        undefined,
                        undefined,
                        sha256,
                    );
                    const execPath = process.execPath;
                    await fs.promises.chmod(tmpPath, 0o755);
                    await fs.promises.rename(tmpPath, execPath);
                    // relaunch detached before exiting, embedded must not respawn
                    if (!process.versions.electron) {
                        try {
                            const child = spawn(
                                execPath,
                                process.argv.slice(1),
                                {
                                    detached: true,
                                    stdio: "ignore",
                                    env: {
                                        ...process.env,
                                        PAPERCRANE_RESPAWNED: "1",
                                    },
                                },
                            );
                            child.on("error", (err) =>
                                console.error("[PaperCrane:Update] respawn failed:", err),
                            );
                            child.unref();
                            // let the replacement bind before handing off
                            await new Promise((r) => setTimeout(r, 300));
                        } catch (err) {
                            console.error("[PaperCrane:Update] respawn failed:", err);
                        }
                    }
                    process.exit(0);
                } catch (err) {
                    console.error("[PaperCrane:Update:Error]", err);
                    try {
                        if (fs.existsSync(tmpPath)) await fs.promises.unlink(tmpPath);
                    } catch (cleanupErr) {
                        console.error("[PaperCrane:Update] tmp cleanup failed:", cleanupErr);
                    }
                }
            }, 500);
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
