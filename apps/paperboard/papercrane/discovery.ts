// mDNS advertisement, fails soft, loopback never advertised
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Bonjour } from "bonjour-service";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import pkg from "../package.json";

export const PAPERCRANE_MDNS_TYPE = "papercrane";
// version travels with the app package.json — one source, never a drift
export const PAPERCRANE_VERSION = pkg.version;

export interface AdvertiseOptions {
    port: number;
    host?: string;
    name?: string;
}

export interface AdvertisementHandle {
    stop: () => void;
}

function isLoopbackHost(host?: string): boolean {
    if (!host) return false;
    return (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "::1" ||
        host === "::ffff:127.0.0.1"
    );
}

// stable machine id for dedupe, never derive from hostname
export function paperCraneMachineId(): string {
    const file = path.join(getPaperboardDir(), "local", "machine-id.json");
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { id?: unknown };
        if (typeof raw?.id === "string" && raw.id.length >= 8) return raw.id;
    } catch (err) { logger.debug("[discovery.ts] op failed:", err) }
    const id = crypto.randomUUID();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ id }, null, 2));
    } catch (err) {
        logger.warn("[Paperboard Server] cannot persist machine id, using ephemeral one:", err);
    }
    return id;
}

export function advertisePaperCrane(
    options: AdvertiseOptions,
): AdvertisementHandle | null {
    if (isLoopbackHost(options.host)) {
        logger.debug(
            "[Paperboard Server] daemon is loopback-only; skipping mDNS advertisement",
        );
        return null;
    }

    // colliding hostnames rename with a suffix, dedupe by TXT id
    const MAX_ATTEMPTS = 5;
    const RETRY_MS = 2000;
    // probe conflicts are silent, so watchdog a missing 'up'
    const UP_TIMEOUT_MS = 4000;
    const baseName = options.name || os.hostname();

    let attempt = 0;
    let stopped = false;
    let current: { stop: () => void } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let upTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        if (upTimer) {
            clearTimeout(upTimer);
            upTimer = null;
        }
    };

    const handle: AdvertisementHandle = {
        stop: () => {
            stopped = true;
            clearRetry();
            try {
                current?.stop();
            } catch (err) { logger.debug("[discovery.ts] op failed:", err) }
            current = null;
        },
    };

    const publishAttempt = () => {
        if (stopped) return;
        attempt += 1;
        const name = attempt === 1 ? baseName : `${baseName} (${attempt})`;
        let bonjour: Bonjour;
        try {
            bonjour = new Bonjour();
        } catch (err) {
            logger.warn("[Paperboard Server] failed to start mDNS advertisement:", err);
            return;
        }
        // publish throws synchronously on invalid config
        let service;
        try {
            service = bonjour.publish({
                name,
                type: PAPERCRANE_MDNS_TYPE,
                port: options.port,
                txt: {
                    id: paperCraneMachineId(),
                    name: os.hostname(),
                    ver: PAPERCRANE_VERSION,
                    os: process.platform,
                },
            });
        } catch (err) {
            logger.warn("[Paperboard Server] failed to start mDNS advertisement:", err);
            try {
                bonjour.destroy();
            } catch (err) { logger.debug("[discovery.ts] op failed:", err) }
            return;
        }

        const stopService = () => {
            try {
                service.stop();
            } catch (err) {
                logger.debug("[Paperboard Server] mDNS unpublish failed:", err);
            }
            try {
                bonjour.destroy();
            } catch (err) {
                logger.debug("[Paperboard Server] mDNS shutdown failed:", err);
            }
        };
        current = { stop: stopService };

        let isUp = false;
        service.on("up", () => {
            isUp = true;
            clearRetry();
            logger.info(
                `[Paperboard Server] advertising via mDNS as "${name}" (_${PAPERCRANE_MDNS_TYPE}._tcp, port ${options.port})`,
            );
        });
        // no 'up' in time means name clash, try the next suffix
        upTimer = setTimeout(() => {
            upTimer = null;
            if (stopped || isUp) return;
            if (attempt < MAX_ATTEMPTS) {
                logger.warn(
                    `[Paperboard Server] mDNS name "${name}" produced no announcement. Retrying as "${baseName} (${attempt + 1})"`,
                );
                stopService();
                retryTimer = setTimeout(publishAttempt, RETRY_MS);
            } else {
                logger.warn(
                    `[Paperboard Server] mDNS advertisement failed for "${name}" after ${MAX_ATTEMPTS} attempts. Continuing undiscovered (manual IP:port still works)`,
                );
            }
        }, UP_TIMEOUT_MS);
        service.on("error", (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (!isUp && /already in use/i.test(msg) && attempt < MAX_ATTEMPTS && !stopped) {
                logger.warn(
                    `[Paperboard Server] mDNS name "${name}" is taken. Retrying as "${baseName} (${attempt + 1})"`,
                );
                stopService();
                retryTimer = setTimeout(publishAttempt, RETRY_MS);
                return;
            }
            logger.warn("[Paperboard Server] mDNS advertisement error:", err);
        });
    };

    publishAttempt();
    return handle;
}
