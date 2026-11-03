// The port registry against real sockets: a port another program holds is
// refused or skipped as the policy says, two claims never share a number,
// and claims survive a daemon restart.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { PortRegistry, portRefusal, probeSystemPort } from "../papercrane/ports";
import { handlePorts } from "../papercrane/rpc/ports";

const dirs: string[] = [];
const servers: net.Server[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise((r) => server.close(r));
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ports-"));
    dirs.push(dir);
    return dir;
}

/** another program holding a TCP port; returns its number */
async function occupy(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen({ port: 0, host: "0.0.0.0" }, resolve));
    servers.push(server);
    return (server.address() as net.AddressInfo).port;
}

const GS = "dev.paperboard.gameserver";
const java = (preferred: number) => ({ name: "java", label: "Game Server (Java)", protocol: "tcp", preferred });

describe("claims", () => {
    test("a free port is given as asked, and kept across a restart", async () => {
        const dir = dataDir();
        const port = await occupy();
        await new Promise((r) => servers.pop()!.close(r));
        const claim = await new PortRegistry(dir).claim(GS, java(port));
        expect(claim).toEqual({ panelId: GS, name: "java", label: "Game Server (Java)", protocol: "tcp", port });
        expect(new PortRegistry(dir).list(GS)).toEqual([claim]);
    });

    test("a port another program uses is refused, naming why", async () => {
        const ports = new PortRegistry(dataDir());
        await ports.setPolicy("refuse");
        const busy = await occupy();
        await expect(ports.claim(GS, java(busy))).rejects.toThrow(`Game Server (Java) can't use port ${busy}: another program on this computer is using it.`);
        expect(ports.list(GS)).toEqual([]);
    });

    test("with next-free, it moves past the program to the next free port", async () => {
        const ports = new PortRegistry(dataDir());
        expect(ports.policy()).toBe("next-free");
        const busy = await occupy();
        const claim = await ports.claim(GS, java(busy));
        expect(claim.port).toBeGreaterThan(busy);
        expect(claim.port).toBeLessThanOrEqual(busy + 100);
    });

    test("two claims never share a number, whichever panel asks", async () => {
        const ports = new PortRegistry(dataDir(), async () => null);
        await ports.claim(GS, java(25565));
        const bedrock = await ports.claim(GS, { name: "bedrock", label: "Game Server (Bedrock)", protocol: "tcp+udp", preferred: 25565 });
        expect(bedrock.port).toBe(25566);
        await ports.setPolicy("refuse");
        await expect(ports.claim("dev.example.other", { ...java(25565), label: "Other server" })).rejects.toThrow(
            "Other server can't use port 25565: Game Server (Java) has it.",
        );
    });

    test("a held claim is returned without probing: its own program may be running on it", async () => {
        const ports = new PortRegistry(dataDir());
        const port = await occupy();
        await new Promise((r) => servers.pop()!.close(r));
        await ports.claim(GS, java(port));
        servers.push(net.createServer().listen({ port, host: "0.0.0.0" }));
        await new Promise((r) => setTimeout(r, 50));
        expect((await ports.claim(GS, java(port))).port).toBe(port);
    });
});

describe("before the program starts", () => {
    test("prepare refuses or moves a port something took since it was claimed", async () => {
        const ports = new PortRegistry(dataDir());
        const port = await occupy();
        await new Promise((r) => servers.pop()!.close(r));
        await ports.claim(GS, java(port));
        servers.push(net.createServer().listen({ port, host: "0.0.0.0" }));
        await new Promise((r) => setTimeout(r, 50));

        await ports.setPolicy("refuse");
        await expect(ports.prepare(GS, "java")).rejects.toThrow(`can't use port ${port}`);
        await ports.setPolicy("next-free");
        const moved = await ports.prepare(GS, "java");
        expect(moved.port).toBeGreaterThan(port);
        expect(ports.list(GS)[0]!.port).toBe(moved.port);
    });

    test("prepare needs a claim", async () => {
        await expect(new PortRegistry(dataDir()).prepare(GS, "java")).rejects.toThrow('No port named "java" is claimed');
    });
});

describe("why the system won't open a port", () => {
    // the system's own refusal: a port below 1024, for a user who isn't root
    const refused = () => new Promise<NodeJS.ErrnoException>((ok, fail) => {
        const server = net.createServer();
        server.once("error", ok);
        server.listen({ port: 1, host: "0.0.0.0" }, () => server.close(() => fail(new Error("port 1 opened"))));
    });

    test.skipIf(process.platform !== "linux" || process.getuid?.() === 0)("a low port is for administrators", async () => {
        expect(await probeSystemPort(1, "tcp")).toBe("this computer only lets administrators open ports below 1024");
    });

    test.skipIf(process.platform !== "linux" || process.getuid?.() === 0)("on Windows the same refusal is a port Windows keeps, at any number", async () => {
        const err = await refused();
        expect(err.code).toBe("EACCES");
        expect(portRefusal(err, 50000, "win32")).toBe("Windows keeps it for itself (it sets ports aside for Hyper-V and WSL), or another program holds it");
        expect(portRefusal(err, 50000, "darwin")).toBe("this computer would not open it (EACCES)");
    });
});

describe("the rpc boundary", () => {
    function ctx(callerPanelId: string | null, dir: string) {
        const replies: { result: any; error?: string; code?: string }[] = [];
        const engine = { getAppDataDir: () => dir, onPanelDataDeleted: () => () => undefined };
        return {
            replies,
            ctx: { engine, callerPanelId: () => callerPanelId, reply: (_id: unknown, result: any, error?: string, code?: string) => replies.push({ result, error, code }) } as any,
        };
    }

    test("a panel claims only its own ports, and the policy is host-only", async () => {
        const dir = dataDir();
        const { replies, ctx: panel } = ctx(GS, dir);
        await handlePorts("ports:claim", 1, { panelId: "dev.example.other", ...java(25565) }, panel);
        expect(replies.pop()).toMatchObject({ result: null, code: "FORBIDDEN" });
        await handlePorts("ports:policy-set", 2, { policy: "refuse" }, panel);
        expect(replies.pop()).toMatchObject({ result: null, code: "FORBIDDEN" });

        const { replies: hostReplies, ctx: host } = ctx(null, dir);
        await handlePorts("ports:policy-set", 3, { policy: "refuse" }, host);
        expect(hostReplies.pop()).toEqual({ result: { policy: "refuse" }, error: undefined, code: undefined });
    });

    test("a refusal reaches the panel as the plain message", async () => {
        const busy = await occupy();
        const { replies, ctx: host } = ctx(null, dataDir());
        await handlePorts("ports:policy-set", 1, { policy: "refuse" }, host);
        await handlePorts("ports:claim", 2, { panelId: GS, ...java(busy) }, host);
        expect(replies.pop()).toEqual({ result: null, error: `Game Server (Java) can't use port ${busy}: another program on this computer is using it.`, code: "CONFLICT" });
    });
});
