// An in-process SSH server for tests: it signs in USER with PASSWORD or an
// authorized key, and runs each command with sh -c in its own folder.
import { spawn } from "node:child_process";
import * as net from "node:net";
import { Server, utils, type AuthContext, type ParsedKey } from "ssh2";
import { tempDir } from "testkit/fs";
import { ed25519Pair } from "./sshKeys";

export const USER = "builder";
export const PASSWORD = "correct horse battery staple";

export interface TestServer {
    port: number;
    hostKey: ParsedKey;
    /** every sign-in attempt the server saw, by method */
    attempts: string[];
    /** the folder commands run in */
    workDir: string;
    close(): Promise<void>;
}

export interface ServerOptions {
    port?: number;
    hostKey?: string;
    /** more host keys the server can present */
    moreHostKeys?: string[];
    /** the public key that may sign in */
    authorizedKey?: string;
    /** the methods offered; default all three */
    methods?: Array<"publickey" | "password" | "keyboard-interactive">;
    /** the environment commands run with (HOME, PATH); default this process's */
    env?: NodeJS.ProcessEnv;
}

const servers: TestServer[] = [];
export const newHostKey = () => ed25519Pair().private;

export function parsed(key: string): ParsedKey {
    const result = utils.parseKey(key);
    if (result instanceof Error) throw result;
    return Array.isArray(result) ? result[0] : result;
}

export async function startServer(options: ServerOptions = {}): Promise<TestServer> {
    const hostKey = options.hostKey ?? newHostKey();
    const methods = options.methods ?? ["publickey", "password", "keyboard-interactive"];
    const authorized = options.authorizedKey === undefined ? undefined : parsed(options.authorizedKey);
    const attempts: string[] = [];
    const workDir = tempDir("pb-ssh-work-");
    const connected = new Set<{ end(): void }>();
    const server = new Server({ hostKeys: [hostKey, ...(options.moreHostKeys ?? [])] }, (client) => {
        connected.add(client);
        client.on("close", () => connected.delete(client));
        client.on("authentication", (ctx: AuthContext) => {
            attempts.push(ctx.method);
            const reject = () => ctx.reject(methods);
            if (ctx.username !== USER || !(methods as string[]).includes(ctx.method)) return reject();
            if (ctx.method === "password") return ctx.password === PASSWORD ? ctx.accept() : reject();
            if (ctx.method === "keyboard-interactive") {
                return ctx.prompt([{ prompt: "Password: ", echo: false }], (answers) => (answers[0] === PASSWORD ? ctx.accept() : reject()));
            }
            if (ctx.method === "publickey") {
                if (!authorized || !authorized.getPublicSSH().equals(ctx.key.data)) return reject();
                if (!ctx.signature) return ctx.accept();
                return authorized.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) ? ctx.accept() : reject();
            }
            reject();
        });
        client.on("ready", () => {
            client.on("session", (acceptSession) => {
                acceptSession().on("exec", (accept, _reject, info) => {
                    const channel = accept();
                    const child = spawn("sh", ["-c", info.command], { cwd: workDir, env: options.env ?? process.env, stdio: "pipe" });
                    channel.pipe(child.stdin);
                    child.stdout.pipe(channel, { end: false });
                    child.stderr.pipe(channel.stderr, { end: false });
                    // as sshd without a terminal: the command sees its stdin end and
                    // no signal; one that stays on is stopped so no test leaves it running
                    channel.on("close", () => {
                        child.stdin.end();
                        const stop = setTimeout(() => child.kill("SIGKILL"), 5_000);
                        child.once("close", () => clearTimeout(stop));
                    });
                    child.on("close", (code) => {
                        channel.exit(code ?? 1);
                        channel.end();
                    });
                });
            });
        });
        // quiet: a client that went away mid-test is the test's own doing
        client.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const handle: TestServer = {
        port,
        hostKey: parsed(hostKey),
        attempts,
        workDir,
        // a closed server leaves the list, so closeServers doesn't close it twice
        close: () => new Promise<void>((resolve) => {
            const at = servers.indexOf(handle);
            if (at >= 0) servers.splice(at, 1);
            server.close(() => resolve());
            for (const client of connected) client.end();
        }),
    };
    servers.push(handle);
    return handle;
}


/** stops every server a test started */
export async function closeServers(): Promise<void> {
    for (const server of servers.splice(0)) await server.close();
}
