// mDNS/Bonjour advertisement for PaperCrane daemons.
//
// Daemons publish a `_papercrane._tcp` service so Paperboard (and other
// clients) can discover them on the local network without manual host/port
// entry. Everything here fails soft: an unavailable mDNS stack, firewall
// blocks, or multicast hiccups degrade to a log line — never a crash.
//
// Loopback-bound daemons (the embedded instance inside Electron) are NOT
// advertised: they are unreachable from other machines, and advertising them
// would produce dead entries in remote discovery lists.

import * as os from "os";
import { Bonjour } from "bonjour-service";
import { logger } from "./logger";

export const PAPERCRANE_MDNS_TYPE = "papercrane";
export const PAPERCRANE_VERSION = "1.0.0";

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

// Stable per-machine identifier carried in TXT records so browsers can
// dedupe re-announcements across restarts and address changes.
export function paperCraneMachineId(): string {
    const hostname = os.hostname().toLowerCase();
    const sanitized = hostname.replace(/[^a-z0-9_-]/g, "-");
    return sanitized || "papercrane";
}

export function advertisePaperCrane(
    options: AdvertiseOptions,
): AdvertisementHandle | null {
    if (isLoopbackHost(options.host)) {
        logger.debug(
            "[PaperCrane] daemon is loopback-only — skipping mDNS advertisement",
        );
        return null;
    }

    try {
        const bonjour = new Bonjour();
        const hostname = os.hostname();
        const name = options.name || hostname;
        // bonjour-service throws synchronously on invalid config — covered
        // by the try/catch above; anything after this point is runtime-level.
        const service = bonjour.publish({
            name,
            type: PAPERCRANE_MDNS_TYPE,
            port: options.port,
            txt: {
                id: paperCraneMachineId(),
                name: hostname,
                ver: PAPERCRANE_VERSION,
                os: process.platform,
            },
        });

        service.on("error", (err: unknown) => {
            logger.warn("[PaperCrane] mDNS advertisement error:", err);
        });
        service.on("up", () => {
            logger.debug(
                `[PaperCrane] mDNS service "${name}" announced on port ${options.port}`,
            );
        });
        logger.info(
            `[PaperCrane] advertising via mDNS as "${name}" (_${PAPERCRANE_MDNS_TYPE}._tcp, port ${options.port})`,
        );

        return {
            stop: () => {
                try {
                    service.stop();
                } catch (err) {
                    logger.debug("[PaperCrane] mDNS unpublish failed:", err);
                }
                try {
                    bonjour.destroy();
                } catch (err) {
                    logger.debug("[PaperCrane] mDNS shutdown failed:", err);
                }
            },
        };
    } catch (err) {
        logger.warn("[PaperCrane] failed to start mDNS advertisement:", err);
        return null;
    }
}
