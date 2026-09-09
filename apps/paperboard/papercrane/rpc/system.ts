import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { getDetailedOsInfo, getNetworkIp } from "../index";
import {
    notifyComputer,
    screenshotComputer,
    setComputerVolume,
    setComputerMuted,
    beepComputer,
} from "../syscontrol";
import pkg from "../../package.json";
import type { RpcContext } from "./context";

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
    } catch {
        return false;
    }
}

export async function handleSystem(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { reply } = ctx;
    switch (action) {
        case "system:ip": {
            reply(id, { ip: getNetworkIp() });
            return true;
        }
        case "system:info": {
            const osInfo = getDetailedOsInfo();
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
        case "system:notify": {
            await notifyComputer(
                String(params.title || "Paperboard"),
                String(params.message || ""),
            );
            reply(id, { success: true });
            return true;
        }
        case "system:screenshot": {
            const savePath = await screenshotComputer(String(params.savePath || "screenshot.png"));
            reply(id, { savePath });
            return true;
        }
        case "system:set-volume": {
            const volume = await setComputerVolume(Number(params.volume ?? 50));
            reply(id, { volume });
            return true;
        }
        case "system:set-muted": {
            const muted = await setComputerMuted(Boolean(params.muted));
            reply(id, { muted });
            return true;
        }
        case "system:beep": {
            await beepComputer();
            reply(id, { success: true });
            return true;
        }
        case "system:update": {
            const { downloadUrl, sha256 } = params;
            if (!downloadUrl || !isSafeUpdateUrl(downloadUrl)) {
                reply(id, null, "Refusing update: download URL must be https (or http to localhost)");
                return true;
            }
            if (process.platform === "win32") {
                // no in-place swap over a running executable on Windows
                reply(id, null, "Self-update is not supported on Windows yet");
                return true;
            }
            reply(id, { success: true, message: "Update initiated" });
            setTimeout(async () => {
                try {
                    const res = await fetch(downloadUrl);
                    if (!res.ok) return;
                    const buffer = Buffer.from(await res.arrayBuffer());
                    if (!sha256) {
                        console.error("[PaperCrane:Update] Refusing update without sha256");
                        return;
                    }
                    const actual = crypto
                        .createHash("sha256")
                        .update(buffer)
                        .digest("hex")
                        .toLowerCase();
                    if (actual !== String(sha256).toLowerCase()) {
                        console.error(
                            `[PaperCrane:Update] SHA256 mismatch: expected ${sha256}, got ${actual}`,
                        );
                        return;
                    }
                    const execPath = process.execPath;
                    const tmpPath = `${execPath}.tmp-${Date.now()}`;
                    await fs.promises.writeFile(tmpPath, buffer, { mode: 0o755 });
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
                }
            }, 500);
            return true;
        }
        default:
            return false;
    }
}
