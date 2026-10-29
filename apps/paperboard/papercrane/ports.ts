// Network ports panels open on this computer. A panel claims a named port
// ("java", "bedrock") and the daemon decides which number it gets: never
// one another claim holds, and never one another program on the computer
// is using. When the port asked for is taken, the user's setting decides:
// refuse with an error naming who has it, or move to the next free port.
// Claims live in <data dir>/ports.json; a panel's claims are forgotten when
// its data is deleted, so a reinstall that keeps data keeps its ports.
import * as dgram from "dgram";
import * as net from "net";
import * as path from "path";
import { isPanelId } from "../../../packages/paperapi/src/panelIdentity";
import { readStateFileSync, writeJsonAtomic } from "./storage";
import { ErrorCode } from "./protocol";
import { RpcError, invalidParams } from "./rpc/errors";

export type PortProtocol = "tcp" | "udp" | "tcp+udp";
/** what happens when the port asked for is taken */
export type PortPolicy = "refuse" | "next-free";

export interface PortClaim {
    panelId: string;
    /** the panel's own name for the port, unique per panel */
    name: string;
    /** who holds it, for people: "Game Server (Java)" */
    label: string;
    protocol: PortProtocol;
    port: number;
}

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

export function isPortNumber(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

function isProtocol(value: unknown): value is PortProtocol {
    return value === "tcp" || value === "udp" || value === "tcp+udp";
}

function parseClaim(raw: any): PortClaim | null {
    if (!raw || typeof raw !== "object") return null;
    if (!isPanelId(raw.panelId) || typeof raw.name !== "string" || !NAME_RE.test(raw.name)) return null;
    if (typeof raw.label !== "string" || raw.label.length > LABEL_MAX || !isProtocol(raw.protocol) || !isPortNumber(raw.port)) return null;
    return { panelId: raw.panelId, name: raw.name, label: raw.label, protocol: raw.protocol, port: raw.port };
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

/** opens and closes the port the way a server would, on every interface */
export const probeSystemPort: PortProbe = async (port, protocol) => {
    const errors = [
        ...(protocol !== "udp" ? [await probeTcp(port)] : []),
        ...(protocol !== "tcp" ? [await probeUdp(port)] : []),
    ].filter((err): err is NodeJS.ErrnoException => err !== null);
    const err = errors[0];
    if (!err) return null;
    if (err.code === "EADDRINUSE") return "another program on this computer is using it";
    if (err.code === "EACCES") return "this computer only lets administrators open ports below 1024";
    return `this computer would not open it (${err.code ?? err.message})`;
};

export class PortRegistry {
    private readonly file: string;
    private state: PortsFile;
    // one change at a time: two claims must not both see a port as free
    private queue: Promise<unknown> = Promise.resolve();

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

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }

    private save(): Promise<void> {
        return writeJsonAtomic(this.file, this.state);
    }

    policy(): PortPolicy {
        return this.state.policy;
    }

    setPolicy(policy: unknown): Promise<PortPolicy> {
        if (policy !== "refuse" && policy !== "next-free") throw invalidParams(`Invalid port policy: ${JSON.stringify(policy)}`);
        return this.serial(async () => {
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

    /** why `port` cannot be given to (panelId, name), or null when it can */
    private async problem(port: number, protocol: PortProtocol, panelId: string, name: string): Promise<string | null> {
        const holder = this.state.claims.find((c) => c.port === port && !(c.panelId === panelId && c.name === name));
        if (holder) return `${holder.label} has it`;
        return this.probe(port, protocol);
    }

    /** the port asked for, or, when the policy allows, the next free one */
    private async allocate(wanted: number, protocol: PortProtocol, panelId: string, name: string, label: string): Promise<number> {
        const problem = await this.problem(wanted, protocol, panelId, name);
        if (!problem) return wanted;
        if (this.state.policy === "refuse") {
            throw new PortTakenError(`${label} can't use port ${wanted}: ${problem}.`);
        }
        const last = Math.min(65535, wanted + NEXT_FREE_SPAN);
        for (let port = wanted + 1; port <= last; port++) {
            if (!(await this.problem(port, protocol, panelId, name))) return port;
        }
        throw new PortTakenError(`${label} can't use port ${wanted} (${problem}), and ports ${wanted + 1} to ${last} are taken too.`);
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
     */
    claim(panelId: string, params: { name: unknown; label: unknown; protocol: unknown; preferred: unknown }): Promise<PortClaim> {
        const { name, label, protocol, preferred } = params;
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        if (typeof label !== "string" || !label.trim() || label.length > LABEL_MAX) throw invalidParams("A port needs a label of at most 80 characters");
        if (!isProtocol(protocol)) throw invalidParams(`Invalid protocol: ${JSON.stringify(protocol)}`);
        if (!isPortNumber(preferred)) throw invalidParams(`Invalid port: ${JSON.stringify(preferred)}`);
        return this.serial(async () => {
            const held = this.find(panelId, name);
            if (held && held.port === preferred && held.protocol === protocol) {
                return held.label === label ? { ...held } : this.store({ ...held, label });
            }
            const port = await this.allocate(preferred, protocol, panelId, name, label);
            return this.store({ panelId, name, label, protocol, port });
        });
    }

    /**
     * Right before the panel's program opens the port: checks the computer
     * again, since anything could have started on it since it was claimed.
     * A taken port is refused or moved, as the policy says.
     */
    prepare(panelId: string, name: unknown): Promise<PortClaim> {
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        return this.serial(async () => {
            const held = this.find(panelId, name);
            if (!held) throw new RpcError(ErrorCode.NOT_FOUND, `No port named "${name}" is claimed; claim it first.`);
            const port = await this.allocate(held.port, held.protocol, panelId, name, held.label);
            return port === held.port ? { ...held } : this.store({ ...held, port });
        });
    }

    release(panelId: string, name: unknown): Promise<void> {
        if (typeof name !== "string" || !NAME_RE.test(name)) throw invalidParams(`Invalid port name: ${JSON.stringify(name)}`);
        return this.serial(async () => {
            if (!this.find(panelId, name)) return;
            this.state = { ...this.state, claims: this.state.claims.filter((c) => !(c.panelId === panelId && c.name === name)) };
            await this.save();
        });
    }

    forgetPanel(panelId: string): Promise<void> {
        return this.serial(async () => {
            if (!this.state.claims.some((c) => c.panelId === panelId)) return;
            this.state = { ...this.state, claims: this.state.claims.filter((c) => c.panelId !== panelId) };
            await this.save();
        });
    }
}
