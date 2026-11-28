// Network ports panels open on this computer. A panel claims a named port
// ("java", "bedrock") and the daemon decides which number it gets: never
// one another claim holds, and never one another program on the computer
// is using. When the port asked for is taken, the user's setting decides:
// refuse with an error naming who has it, or move to the next free port.
// A claim can hold several ports in a row (`count`) for a server that opens
// the ones after its own, as Valheim opens its port and the next: they are
// checked, refused and moved together, never one without the others.
// Claims live in <data dir>/ports.json; a panel's claims are forgotten when
// its data is deleted, so a reinstall that keeps data keeps its ports.
import * as dgram from "dgram";
import * as net from "net";
import * as path from "path";
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { readStateFileSync, writeJsonAtomic } from "../core/storage";
import { SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import { ErrorCode } from "../core/protocol";
import { RpcError, invalidParams } from "../rpc/errors";
import type { PortClaim, PortPolicy, PortProtocol } from "@mileniumhq/paperapi";

interface PortsFile {
    version: 1;
    policy: PortPolicy;
    claims: PortClaim[];
}

export const DEFAULT_PORT_POLICY: PortPolicy = "next-free";
/** how far past the port asked for "next free" looks */
export const NEXT_FREE_SPAN = 100;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LABEL_MAX = 80;
/** the most ports in a row one claim holds */
export const MAX_PORT_COUNT = 16;

export function isPortNumber(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

/** a count that fits from `port` to 65535; claims saved before counts existed hold one */
function isCount(value: unknown, port: number): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PORT_COUNT && port + (value as number) - 1 <= 65535;
}

/** "port 2456", or "ports 2456 to 2457" for a claim of two */
export function portsText(port: number, count: number): string {
    return count === 1 ? `port ${port}` : `ports ${port} to ${port + count - 1}`;
}

function isProtocol(value: unknown): value is PortProtocol {
    return value === "tcp" || value === "udp" || value === "tcp+udp";
}

function parseClaim(raw: any): PortClaim | null {
    if (!raw || typeof raw !== "object") return null;
    if (!isPanelId(raw.panelId) || typeof raw.name !== "string" || !NAME_RE.test(raw.name)) return null;
    if (typeof raw.label !== "string" || raw.label.length > LABEL_MAX || !isProtocol(raw.protocol) || !isPortNumber(raw.port)) return null;
    const count = raw.count ?? 1;
    if (!isCount(count, raw.port)) return null;
    return { panelId: raw.panelId, name: raw.name, label: raw.label, protocol: raw.protocol, port: raw.port, count };
}

export class PortTakenError extends RpcError {
    constructor(message: string) {
        super(ErrorCode.CONFLICT, message);
        this.name = "PortTakenError";
    }
}

/** why a port cannot be opened on this computer, or null when it can */
export type PortProbe = (port: number, protocol: PortProtocol) => Promise<string | null>;

function probeTcp(port: number): Promise<NodeJS.ErrnoException | null> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err) => resolve(err as NodeJS.ErrnoException));
        server.listen({ port, host: "0.0.0.0", exclusive: true }, () => server.close(() => resolve(null)));
    });
}

function probeUdp(port: number): Promise<NodeJS.ErrnoException | null> {
    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        socket.once("error", (err) => {
            socket.close();
            resolve(err as NodeJS.ErrnoException);
        });
        socket.bind({ port, address: "0.0.0.0", exclusive: true }, () => socket.close(() => resolve(null)));
    });
}

/** why the system refused to open a port, for people */
export function portRefusal(err: NodeJS.ErrnoException, port: number, platform: NodeJS.Platform = process.platform): string {
    if (err.code === "EADDRINUSE") return "another program on this computer is using it";
    if (err.code === "EACCES") {
        // Windows keeps ranges of ports for itself (Hyper-V, WSL, Docker), chosen anew at each boot
        if (platform === "win32") return "Windows keeps it for itself (it sets ports aside for Hyper-V and WSL), or another program holds it";
        if (port < 1024) return "this computer only lets administrators open ports below 1024";
    }
    return `this computer would not open it (${err.code ?? err.message})`;
}

/** opens and closes the port the way a server would, on every interface */
export const probeSystemPort: PortProbe = async (port, protocol) => {
    const errors = [
        ...(protocol !== "udp" ? [await probeTcp(port)] : []),
        ...(protocol !== "tcp" ? [await probeUdp(port)] : []),
    ].filter((err): err is NodeJS.ErrnoException => err !== null);
    return errors[0] ? portRefusal(errors[0], port) : null;
};

export class PortRegistry {
    private readonly file: string;
    private state: PortsFile;
    // one change at a time: two claims must not both see a port as free
    private readonly queue = new SerialQueue();

    constructor(
        dataDir: string,
        private readonly probe: PortProbe = probeSystemPort,
    ) {
        this.file = path.join(dataDir, "ports.json");
        const raw = readStateFileSync<any>(this.file, null, "ports.json");
        this.state = {
            version: 1,
            policy: raw?.policy === "refuse" || raw?.policy === "next-free" ? raw.policy : DEFAULT_PORT_POLICY,
            claims: Array.isArray(raw?.claims) ? raw.claims.map(parseClaim).filter((c: PortClaim | null): c is PortClaim => c !== null) : [],
        };
    }

    private save(): Promise<void> {
        return writeJsonAtomic(this.file, this.state);
    }

    policy(): PortPolicy {
        return this.state.policy;
    }

    setPolicy(policy: unknown): Promise<PortPolicy> {
        if (policy !== "refuse" && policy !== "next-free") throw invalidParams(`Invalid port policy: ${JSON.stringify(policy)}`);
        return this.queue.run(async () => {
            this.state = { ...this.state, policy };
            await this.save();
            return policy;
        });
    }

    /** every claim on the computer; the shell shows them */
    all(): PortClaim[] {
        return this.state.claims.map((c) => ({ ...c }));
    }

    list(panelId: string): PortClaim[] {
        return this.all().filter((c) => c.panelId === panelId);
    }

    private find(panelId: string, name: string): PortClaim | undefined {
        return this.state.claims.find((c) => c.panelId === panelId && c.name === name);
    }

    /**
     * Why the `count` ports from `port` cannot be given to (panelId, name),
     * or null when they can. A claim of several names the port that is taken.
     */
    private async problem(port: number, count: number, protocol: PortProtocol, panelId: string, name: string): Promise<string | null> {
        for (let at = port; at < port + count; at++) {
            const holder = this.state.claims.find((c) => at >= c.port && at < c.port + c.count && !(c.panelId === panelId && c.name === name));
            const problem = holder ? `${holder.label} has it` : await this.probe(at, protocol);
            if (problem) return count === 1 ? problem : `${problem} (port ${at})`;
        }
        return null;
    }

    /** the ports asked for, or, when the policy allows, the next free run of as many */
    private async allocate(wanted: number, count: number, protocol: PortProtocol, panelId: string, name: string, label: string): Promise<number> {
        const problem = await this.problem(wanted, count, protocol, panelId, name);
        if (!problem) return wanted;
        if (this.state.policy === "refuse") {
            throw new PortTakenError(`${label} can't use ${portsText(wanted, count)}: ${problem}.`);
        }
        const last = Math.min(65535, wanted + NEXT_FREE_SPAN);
        for (let port = wanted + 1; port + count - 1 <= last; port++) {
            if (!(await this.problem(port, count, protocol, panelId, name))) return port;
        }
        throw new PortTakenError(`${label} can't use ${portsText(wanted, count)} (${problem}), and ports ${wanted + 1} to ${last} are taken too.`);
    }

    private async store(claim: PortClaim): Promise<PortClaim> {
        this.state = {
            ...this.state,
            claims: [...this.state.claims.filter((c) => !(c.panelId === claim.panelId && c.name === claim.name)), claim],
        };
        await this.save();
        return { ...claim };
    }

    /**
     * Gives (panelId, name) a port. A claim it already holds is returned as
     * it is, without checking the computer: its own program may be using
     * it. `preferred` asks for a number; a new claim or a different number
     * is checked against every other claim and against the computer.
     * `count` claims that many ports in a row from the number, moved together.
     */
    claim(panelId: string, params: { name: unknown; label: unknown; protocol: unknown; preferred: unknown; count?: unknown }): Promise<PortClaim> {
        const { name, label, protocol, preferred } = params;
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        if (typeof label !== "string" || !label.trim() || label.length > LABEL_MAX) throw invalidParams("A port needs a label of at most 80 characters");
        if (!isProtocol(protocol)) throw invalidParams(`Invalid protocol: ${JSON.stringify(protocol)}`);
        if (!isPortNumber(preferred)) throw invalidParams(`Invalid port: ${JSON.stringify(preferred)}`);
        const count = params.count ?? 1;
        if (!isCount(count, preferred)) throw invalidParams(`Invalid port count: ${JSON.stringify(params.count)}; 1 to ${MAX_PORT_COUNT} ports in a row, ending by 65535`);
        return this.queue.run(async () => {
            const held = this.find(panelId, name);
            if (held && held.port === preferred && held.protocol === protocol && held.count === count) {
                return held.label === label ? { ...held } : this.store({ ...held, label });
            }
            const port = await this.allocate(preferred, count, protocol, panelId, name, label);
            return this.store({ panelId, name, label, protocol, port, count });
        });
    }

    /**
     * Right before the panel's program opens the port: checks the computer
     * again, since anything could have started on it since it was claimed.
     * A taken port is refused or moved, as the policy says.
     */
    prepare(panelId: string, name: unknown): Promise<PortClaim> {
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        return this.queue.run(async () => {
            const held = this.find(panelId, name);
            if (!held) throw new RpcError(ErrorCode.NOT_FOUND, `No port named "${name}" is claimed; claim it first.`);
            const port = await this.allocate(held.port, held.count, held.protocol, panelId, name, held.label);
            return port === held.port ? { ...held } : this.store({ ...held, port });
        });
    }

    release(panelId: string, name: unknown): Promise<void> {
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        return this.queue.run(async () => {
            if (!this.find(panelId, name)) return;
            this.state = { ...this.state, claims: this.state.claims.filter((c) => !(c.panelId === panelId && c.name === name)) };
            await this.save();
        });
    }

    forgetPanel(panelId: string): Promise<void> {
        return this.queue.run(async () => {
            if (!this.state.claims.some((c) => c.panelId === panelId)) return;
            this.state = { ...this.state, claims: this.state.claims.filter((c) => c.panelId !== panelId) };
            await this.save();
        });
    }
}
