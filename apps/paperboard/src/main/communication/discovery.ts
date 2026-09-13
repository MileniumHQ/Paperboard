// mDNS discovery, deduped by machine id + port; fails soft
import { EventEmitter } from "events";
import { Bonjour, type Browser } from "bonjour-service";
import { logger } from "../../../papercrane/logger";
import { PAPERCRANE_MDNS_TYPE } from "../../../papercrane/discovery";

export interface DiscoveredComputer {
    /** stable service identity — dedupe key */
    id: string;
    name: string;
    host: string;
    port: number;
    version?: string;
    os?: string;
}

interface DiscoveredEntry extends DiscoveredComputer {
    fqdn: string;
}

export class DiscoveryService extends EventEmitter {
    private bonjour: Bonjour | null = null;
    private browser: Browser | null = null;
    private services = new Map<string, DiscoveredEntry>();
    private started = false;

    public start(): void {
        if (this.started) return;
        this.started = true;
        try {
            this.bonjour = new Bonjour();
            this.browser = this.bonjour.find({
                type: PAPERCRANE_MDNS_TYPE,
            }) as Browser;

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
                    logger.warn(
                        "[Discovery] failed to process mDNS 'down':",
                        err,
                    );
                }
            });
            // error event untyped; listen defensively
            (this.browser as any).on("error", (err: unknown) => {
                logger.warn("[Discovery] mDNS browser error:", err);
            });

            logger.info(
                `[Discovery] browsing for _${PAPERCRANE_MDNS_TYPE}._tcp services`,
            );
        } catch (err) {
            logger.warn(
                "[Discovery] mDNS unavailable — network discovery disabled:",
                err,
            );
            this.started = false;
        }
    }

    public refresh(): void {
        this.start();
        try {
            this.browser?.update();
        } catch (err) {
            logger.debug("[Discovery] failed to trigger mDNS update:", err);
        }
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
        const entry: DiscoveredEntry = {
            id: key,
            name:
                (typeof service?.txt?.name === "string" && service.txt.name) ||
                String(service?.name || key).replace(/\._[^.]+\._tcp\.?$/, ""),
            host,
            port,
            version:
                typeof service?.txt?.ver === "string"
                    ? service.txt.ver
                    : undefined,
            os:
                typeof service?.txt?.os === "string"
                    ? service.txt.os
                    : undefined,
            fqdn: typeof service?.fqdn === "string" ? service.fqdn : key,
        };
        this.services.set(key, entry);
        logger.debug(
            `[Discovery] PaperCrane online: ${entry.name} (${entry.host}:${entry.port})`,
        );
        this.emitChange();
    }

    private handleDown(service: any): void {
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
            `[Discovery] PaperCrane offline: ${removed.name} (${removed.host}:${removed.port})`,
        );
        this.emitChange();
    }

    private emitChange() {
        this.emit("update", this.list());
    }

    // online machines, sorted by name
    public list(): DiscoveredComputer[] {
        return Array.from(this.services.values())
            .map(({ id, name, host, port, version, os }) => ({
                id,
                name,
                host,
                port,
                version,
                os,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    public stop(): void {
        try {
            this.browser?.stop();
        } catch (err) {
            logger.debug("[Discovery] failed to stop mDNS browser:", err);
        }
        try {
            this.bonjour?.destroy();
        } catch (err) {
            logger.debug("[Discovery] failed to destroy mDNS instance:", err);
        }
        this.browser = null;
        this.bonjour = null;
        this.services.clear();
        this.started = false;
    }
}

export const discovery = new DiscoveryService();
export default discovery;
