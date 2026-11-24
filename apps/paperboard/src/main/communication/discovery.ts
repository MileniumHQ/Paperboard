// mDNS discovery, deduped by machine id + port. A failure is said by the
// next look(), which starts browsing again.
import { EventEmitter } from "events";
import { Bonjour } from "bonjour-service";
import { logger } from "daemon/core/logger";
import { PAPERCRANE_MDNS_TYPE } from "daemon/system/discovery";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { DiscoveredComputer } from "../../shared/shellContract";

interface DiscoveredEntry extends DiscoveredComputer {
    fqdn: string;
}

// what browsing needs of bonjour-service; a test hands in its own network
export interface MdnsBrowser {
    on(event: string, listener: (...args: any[]) => void): unknown;
    update(): void;
    stop(): void;
}
export interface Mdns {
    find(options: { type: string }): MdnsBrowser;
    destroy(): void;
}

export class DiscoveryService extends EventEmitter {
    private mdns: Mdns | null = null;
    private browser: MdnsBrowser | null = null;
    private services = new Map<string, DiscoveredEntry>();
    private started = false;
    // why browsing stopped working, which the Add computer list shows
    private failure: string | null = null;

    constructor(private readonly openMdns: () => Mdns = () => new Bonjour()) {
        super();
    }

    public start(): void {
        if (this.started) return;
        this.started = true;
        this.openBrowser();
    }

    private openBrowser(): void {
        try {
            this.mdns = this.openMdns();
            this.browser = this.mdns.find({ type: PAPERCRANE_MDNS_TYPE });
            this.browser.on("up", (service: any) => {
                try {
                    this.handleUp(service);
                } catch (err) {
                    logger.warn("[Discovery] failed to process mDNS 'up':", err);
                }
            });
            this.browser.on("down", (service: any) => {
                try {
                    this.handleDown(service);
                } catch (err) {
                    logger.warn("[Discovery] failed to process mDNS 'down':", err);
                }
            });
            // a computer announcing again under the same name, at a new port
            // or address, or with new details, comes as an update, never 'up'
            for (const event of ["srv-update", "txt-update"]) {
                this.browser.on(event, (service: any, previous: any) => {
                    try {
                        // one change: the old record goes without a list of its own
                        this.handleDown(previous, false);
                        this.handleUp(service);
                    } catch (err) {
                        logger.warn(`[Discovery] failed to process mDNS '${event}':`, err);
                    }
                });
            }
            // the browser's socket failed (a network change)
            this.browser.on("error", (err: unknown) => this.fail(err));
            logger.info(`[Discovery] browsing for _${PAPERCRANE_MDNS_TYPE}._tcp services`);
        } catch (err) {
            this.fail(err);
        }
    }

    // browsing stopped: the next look() says why and starts it again
    private fail(err: unknown): void {
        logger.warn("[Discovery] mDNS browsing failed:", err);
        this.stop();
        this.failure = errorMessage(err);
    }

    private serviceKey(service: any): string | null {
        const txtId =
            service?.txt && typeof service.txt.id === "string"
                ? service.txt.id
                : null;
        const base =
            txtId || (typeof service?.fqdn === "string" ? service.fqdn : null);
        if (!base) return null;
        // include port: same host can run two daemons under one id
        const port = Number(service?.port) || 0;
        return port ? `${base}:${port}` : base;
    }

    private resolveHost(service: any): string {
        const addresses: unknown[] = Array.isArray(service?.addresses)
            ? service.addresses
            : [];
        for (const addr of addresses) {
            if (
                typeof addr === "string" &&
                addr.includes(".") &&
                !addr.startsWith("127.")
            ) {
                return addr;
            }
        }
        // sender address usually carried here
        return (
            service?.referer?.address ||
            service?.host?.replace(/\.$/, "") ||
            ""
        );
    }

    private handleUp(service: any): void {
        const key = this.serviceKey(service);
        const host = this.resolveHost(service);
        const port = Number(service?.port) || 0;
        if (!key || !host || !port) {
            logger.debug(
                "[Discovery] ignoring malformed mDNS service announcement",
            );
            return;
        }
        this.confirming?.seen.add(key);
        const entry: DiscoveredEntry = {
            id: key,
            name:
                (typeof service?.txt?.name === "string" && service.txt.name) ||
                String(service?.name || key).replace(/\._[^.]+\._tcp\.?$/, ""),
            host,
            port,
            // the .local name it says it answers to (a hint: kept only once
            // its certificate answers there); an older daemon sends none
            mdnsName:
                typeof service?.txt?.mdns === "string" && /^[A-Za-z0-9-]{1,63}\.local$/i.test(service.txt.mdns)
                    ? service.txt.mdns
                    : undefined,
            version:
                typeof service?.txt?.ver === "string"
                    ? service.txt.ver
                    : undefined,
            fingerprint:
                typeof service?.txt?.fp === "string" && service.txt.fp
                    ? service.txt.fp
                    : undefined,
            os:
                typeof service?.txt?.os === "string"
                    ? service.txt.os
                    : undefined,
            fqdn: typeof service?.fqdn === "string" ? service.fqdn : key,
        };
        this.services.set(key, entry);
        logger.debug(
            `[Discovery] Paperboard Server online: ${entry.name} (${entry.host}:${entry.port})`,
        );
        this.emitChange();
    }

    private handleDown(service: any, announce = true): void {
        const key = this.serviceKey(service);
        if (!key) return;
        // match by fqdn too — goodbye can arrive with a partial record
        let removedKey: string | null = null;
        if (this.services.has(key)) {
            removedKey = key;
        } else if (typeof service?.fqdn === "string") {
            const port = Number(service?.port) || 0;
            for (const [k, v] of this.services) {
                if (v.fqdn !== service.fqdn) continue;
                // shared fqdn — only remove the matching port
                if (!port || v.port === port) {
                    removedKey = k;
                    break;
                }
            }
        }
        if (!removedKey) return;
        const removed = this.services.get(removedKey)!;
        this.services.delete(removedKey);
        logger.debug(
            `[Discovery] Paperboard Server offline: ${removed.name} (${removed.host}:${removed.port})`,
        );
        if (announce) this.emitChange();
    }

    private emitChange() {
        this.emit("update", this.list());
    }

    /** what the Add computer list shows: online machines, sorted by name, or
     *  why browsing failed since the last look. Browsing starts again either way. */
    public look(): DiscoveredComputer[] {
        this.start();
        try {
            this.browser?.update();
        } catch (err) {
            this.fail(err);
        }
        const why = this.failure;
        this.failure = null;
        if (why) throw new Error(`Paperboard can't look for computers on this network: ${why}`);
        return this.list();
    }

    // online machines, sorted by name
    public list(): DiscoveredComputer[] {
        return Array.from(this.services.values())
            .map(({ id, name, host, mdnsName, port, version, os, fingerprint }) => ({
                id,
                name,
                host,
                mdnsName,
                port,
                version,
                os,
                fingerprint,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private lastRediscover = 0;
    // a fresh look under way: the computers it has seen again, and when it
    // drops the ones it hasn't
    private confirming: { seen: Set<string>; timer: ReturnType<typeof setTimeout> } | null = null;

    /**
     * A paired computer stopped answering: look again with a fresh browser.
     * A browser keeps each computer at the addresses it first saw, so one
     * that moved to a new IP under the same name is only seen there by a
     * fresh look. The list stays as it is meanwhile; after a few seconds,
     * the computers the fresh look didn't see again are dropped. At most once
     * every 30 seconds.
     */
    public rediscover(): void {
        if (!this.started || Date.now() - this.lastRediscover < 30_000) return;
        this.lastRediscover = Date.now();
        logger.debug("[Discovery] a paired computer is unreachable; looking again");
        if (this.confirming) clearTimeout(this.confirming.timer);
        const confirming = {
            seen: new Set<string>(),
            timer: setTimeout(() => {
                if (this.confirming !== confirming) return;
                this.confirming = null;
                let dropped = false;
                for (const key of [...this.services.keys()]) {
                    if (confirming.seen.has(key)) continue;
                    this.services.delete(key);
                    dropped = true;
                }
                if (dropped) this.emitChange();
            }, 5_000),
        };
        confirming.timer.unref?.();
        this.confirming = confirming;
        this.closeBrowser();
        this.openBrowser();
    }

    private closeBrowser(): void {
        try {
            this.browser?.stop();
        } catch (err) {
            logger.debug("[Discovery] failed to stop mDNS browser:", err);
        }
        try {
            this.mdns?.destroy();
        } catch (err) {
            logger.debug("[Discovery] failed to destroy mDNS instance:", err);
        }
        this.browser = null;
        this.mdns = null;
    }

    public stop(): void {
        this.closeBrowser();
        if (this.confirming) clearTimeout(this.confirming.timer);
        this.confirming = null;
        this.services.clear();
        this.started = false;
    }
}

export const discovery = new DiscoveryService();
export default discovery;
