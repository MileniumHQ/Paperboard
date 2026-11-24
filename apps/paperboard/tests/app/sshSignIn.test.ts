// Signing in to another computer over SSH to set it up: known_hosts is kept
// as `ssh` keeps it (accept-new), a changed host key stops before any
// credential goes out, the password is never written down, and commands
// carry bytes and exit codes exactly. Against a real ssh2 server on
// 127.0.0.1 that runs each command with `sh -c` in a temp folder.
import { afterEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { utils } from "ssh2";
import { openSsh, SshHostKeyChanged, SshPasswordRefused, SshSignInNeeded, SshUnreachable, type SshSession } from "../../src/main/computerSetup/ssh";
import { fingerprintOf } from "../../src/main/computerSetup/knownHosts";
import { listTree, tempDir } from "testkit/fs";
import { closeServers, newHostKey, parsed, PASSWORD, startServer, USER, type TestServer } from "./sshServer";
import { ed25519Pair } from "./sshKeys";

const sessions: SshSession[] = [];

afterEach(async () => {
    for (const session of sessions.splice(0)) session.close();
    await closeServers();
});

async function open(server: TestServer, sshDir: string, extra: { password?: string; username?: string } = {}): Promise<SshSession> {
    const session = await openSsh({ host: "127.0.0.1", port: server.port, username: extra.username ?? USER, password: extra.password, sshDir, localUser: "local", agent: null });
    sessions.push(session);
    return session;
}

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("it signed in"); }, (err: Error) => err);

const knownHosts = (sshDir: string) => path.join(sshDir, "known_hosts");

describe("host keys", () => {
    // Inventory: Security — a computer whose host key changed is refused before any credential is sent, and known_hosts is left as it was.
    test("the first sign-in writes the host key down, the same key signs in again, and a different key stops before any credential", async () => {
        const sshDir = path.join(tempDir("pb-ssh-home-"), ".ssh");
        const first = await startServer();
        const session = await open(first, sshDir, { password: PASSWORD });
        expect(session.username).toBe(USER);
        expect(session.host).toBe("127.0.0.1");
        expect(session.hostKeyFingerprint).toBe(fingerprintOf(first.hostKey.getPublicSSH()));
        const written = fs.readFileSync(knownHosts(sshDir), "utf8");
        expect(written).toBe(`[127.0.0.1]:${first.port} ssh-ed25519 ${first.hostKey.getPublicSSH().toString("base64")}\n`);
        if (process.platform !== "win32") {
            expect(fs.statSync(sshDir).mode & 0o777).toBe(0o700);
            expect(fs.statSync(knownHosts(sshDir)).mode & 0o777).toBe(0o600);
        }
        session.close();

        await open(first, sshDir, { password: PASSWORD });
        expect(fs.readFileSync(knownHosts(sshDir), "utf8")).toBe(written);
        await first.close();

        const impostor = await startServer({ port: first.port });
        const err = await failure(open(impostor, sshDir, { password: PASSWORD }));
        expect(err).toBeInstanceOf(SshHostKeyChanged);
        expect((err as SshHostKeyChanged).fingerprint).toBe(fingerprintOf(impostor.hostKey.getPublicSSH()));
        expect(err.message).toContain("nothing was sent");
        expect(impostor.attempts).toEqual([]);
        expect(fs.readFileSync(knownHosts(sshDir), "utf8")).toBe(written);
    });

    // Inventory: Security — a host key pinned only in a known_hosts file the ssh config names is checked too, never taken for new.
    test("a key pinned in another known_hosts file ssh reads stops a different one, and nothing is written down", async () => {
        const sshDir = path.join(tempDir("pb-ssh-home-"), ".ssh");
        fs.mkdirSync(sshDir, { recursive: true });
        const server = await startServer();
        const pinned = path.join(sshDir, "..", "system_known_hosts");
        // another key for that address, as a system file would hold it: the server is an impostor
        fs.writeFileSync(pinned, `[127.0.0.1]:${server.port} ssh-ed25519 ${parsed(newHostKey()).getPublicSSH().toString("base64")}\n`);
        fs.writeFileSync(path.join(sshDir, "config"), `GlobalKnownHostsFile ${pinned}\n`);
        const err = await failure(open(server, sshDir, { password: PASSWORD }));
        expect(err).toBeInstanceOf(SshHostKeyChanged);
        expect(err.message).toContain(pinned);
        expect(server.attempts).toEqual([]);
        expect(fs.existsSync(knownHosts(sshDir))).toBe(false);
    });

    test("with HostKeyAlias, the key is filed and checked under the alias", async () => {
        const sshDir = path.join(tempDir("pb-ssh-home-"), ".ssh");
        fs.mkdirSync(sshDir, { recursive: true });
        fs.writeFileSync(path.join(sshDir, "config"), "HostKeyAlias lab-box\n");
        const server = await startServer();
        (await open(server, sshDir, { password: PASSWORD })).close();
        expect(fs.readFileSync(knownHosts(sshDir), "utf8")).toBe(`lab-box ssh-ed25519 ${server.hostKey.getPublicSSH().toString("base64")}\n`);
        await server.close();
        const impostor = await startServer({ port: server.port });
        expect(await failure(open(impostor, sshDir, { password: PASSWORD }))).toBeInstanceOf(SshHostKeyChanged);
        expect(impostor.attempts).toEqual([]);
    });

    test("a known_hosts line without a trailing newline gets one before the new host", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        fs.writeFileSync(knownHosts(sshDir), "other.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl");
        const server = await startServer();
        await open(server, sshDir, { password: PASSWORD });
        const lines = fs.readFileSync(knownHosts(sshDir), "utf8").split("\n");
        expect(lines[0]).toStartWith("other.example ");
        expect(lines[1]).toStartWith(`[127.0.0.1]:${server.port} ssh-ed25519 `);
    });

    test("a host with several keys is asked for the type known_hosts has, so it isn't taken for changed", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const rsa = utils.generateKeyPairSync("rsa", { bits: 2048 }).private;
        const server = await startServer({ moreHostKeys: [rsa] });
        const rsaBlob = parsed(rsa).getPublicSSH();
        const written = `[127.0.0.1]:${server.port} ssh-rsa ${rsaBlob.toString("base64")}\n`;
        fs.writeFileSync(knownHosts(sshDir), written);
        const session = await open(server, sshDir, { password: PASSWORD });
        expect(session.hostKeyFingerprint).toBe(fingerprintOf(rsaBlob));
        expect(fs.readFileSync(knownHosts(sshDir), "utf8")).toBe(written);
    });

    test("an ssh config alias connects to its HostName, Port and User, and the key is written under that name", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const server = await startServer();
        fs.writeFileSync(path.join(sshDir, "config"), `Host workshop\n    HostName 127.0.0.1\n    Port ${server.port}\n    User ${USER}\n`);
        const session = await openSsh({ host: "workshop", password: PASSWORD, sshDir, localUser: "local", agent: null });
        sessions.push(session);
        expect(session.host).toBe("127.0.0.1");
        expect(session.username).toBe(USER);
        expect(fs.readFileSync(knownHosts(sshDir), "utf8")).toStartWith(`[127.0.0.1]:${server.port} ssh-ed25519 `);
    });
});

describe("signing in", () => {
    test("with the id_ed25519 in the ssh folder, no password needed", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const pair = ed25519Pair();
        fs.writeFileSync(path.join(sshDir, "id_ed25519"), pair.private, { mode: 0o600 });
        const server = await startServer({ authorizedKey: pair.public, methods: ["publickey"] });
        const session = await open(server, sshDir);
        expect(session.username).toBe(USER);
        expect(server.attempts).toContain("publickey");
    });

    test("an encrypted key is passed over for the password", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const pair = ed25519Pair({ passphrase: "locked", cipher: "aes256-ctr", rounds: 4 });
        fs.writeFileSync(path.join(sshDir, "id_ed25519"), pair.private, { mode: 0o600 });
        const server = await startServer({ authorizedKey: pair.public });
        await open(server, sshDir, { password: PASSWORD });
        expect(server.attempts).not.toContain("publickey");
    });

    test("with a password, and over keyboard-interactive when that is all the server takes", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const withPassword = await startServer({ methods: ["password"] });
        await open(withPassword, sshDir, { password: PASSWORD });
        const interactive = await startServer({ methods: ["keyboard-interactive"] });
        await open(interactive, sshDir, { password: PASSWORD });
        expect(interactive.attempts.at(-1)).toBe("keyboard-interactive");
    });

    test("no key it takes and no password asks for one; a wrong password is refused", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const stranger = ed25519Pair();
        fs.writeFileSync(path.join(sshDir, "id_ed25519"), stranger.private, { mode: 0o600 });
        const server = await startServer({ authorizedKey: ed25519Pair().public });
        const needed = await failure(open(server, sshDir));
        expect(needed).toBeInstanceOf(SshSignInNeeded);
        expect(needed.message).toContain(USER);
        const refused = await failure(open(server, sshDir, { password: "wrong" }));
        expect(refused).toBeInstanceOf(SshPasswordRefused);
        expect(refused.message).toBe(`127.0.0.1:${server.port} refused the password for ${USER}.`);
    });

    // Inventory: Security — the SSH password is used for the one sign-in and never written to disk.
    test("the password is in no file of the ssh folder after a session", async () => {
        const home = tempDir("pb-ssh-home-");
        const sshDir = path.join(home, ".ssh");
        const server = await startServer();
        const session = await open(server, sshDir, { password: PASSWORD });
        expect((await session.exec("echo signed in")).stdout).toBe("signed in\n");
        session.close();
        await failure(open(server, sshDir, { password: `${PASSWORD}!` }));
        const files = listTree(home).map((rel) => path.join(home, rel)).filter((file) => fs.statSync(file).isFile());
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(fs.readFileSync(file, "utf8")).not.toContain(PASSWORD);
    });

    test("a closed port and a server that isn't SSH are unreachable, each saying why", async () => {
        const sshDir = tempDir("pb-ssh-dir-");
        const closed = net.createServer();
        await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const closedPort = (closed.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => closed.close(() => resolve()));
        const refused = await failure(openSsh({ host: "127.0.0.1", port: closedPort, sshDir, localUser: USER, agent: null }));
        expect(refused).toBeInstanceOf(SshUnreachable);
        expect(refused.message).toBe(`Couldn't reach 127.0.0.1:${closedPort}: connection refused (is SSH turned on there?)`);

        const web = net.createServer((socket) => socket.resume().end("HTTP/1.1 400 Bad Request\r\n\r\n"));
        await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
        const webPort = (web.address() as net.AddressInfo).port;
        const notSsh = await failure(openSsh({ host: "127.0.0.1", port: webPort, sshDir, localUser: USER, agent: null }));
        await new Promise<void>((resolve) => web.close(() => resolve()));
        expect(notSsh).toBeInstanceOf(SshUnreachable);
        expect(notSsh.message).toStartWith(`127.0.0.1:${webPort} `);
        expect(fs.existsSync(knownHosts(sshDir))).toBe(false);
    });
});

describe("running commands", () => {
    test("binary stdin arrives byte for byte, and a failing exit code is returned, not thrown", async () => {
        const server = await startServer();
        const session = await open(server, tempDir("pb-ssh-dir-"), { password: PASSWORD });
        const payload = crypto.randomBytes(300_000);
        const copied = await session.exec("cat > upload.bin && wc -c < upload.bin", { stdin: payload });
        expect(copied.code).toBe(0);
        expect(copied.stdout.trim()).toBe(String(payload.length));
        expect(fs.readFileSync(path.join(server.workDir, "upload.bin")).equals(payload)).toBe(true);

        const failed = await session.exec("echo oops >&2; exit 7");
        expect(failed).toEqual({ code: 7, stdout: "", stderr: "oops\n" });
    });

    test("a command that outlives its timeout rejects", async () => {
        const server = await startServer();
        const session = await open(server, tempDir("pb-ssh-dir-"), { password: PASSWORD });
        fs.mkdirSync(path.join(server.workDir, "gate"));
        const err = await failure(session.exec("mkfifo gate/fifo && read line < gate/fifo", { timeoutMs: 300 }));
        expect(err.message).toContain("didn't finish");
    });

    test("stream delivers each line as it is printed, and cancel closes the channel", async () => {
        const server = await startServer();
        const session = await open(server, tempDir("pb-ssh-dir-"), { password: PASSWORD });
        const fifo = path.join(server.workDir, "go");
        const lines: string[] = [];
        let sawFirst: () => void = () => undefined;
        const first = new Promise<void>((resolve) => { sawFirst = resolve; });
        const running = session.stream(`mkfifo go && printf 'one\\r\\n' && read x < go && echo two && printf three`, (line) => {
            lines.push(line);
            if (line === "one") sawFirst();
        });
        await first;
        expect(lines).toEqual(["one"]);
        fs.writeFileSync(fifo, "\n");
        const result = await running.done;
        expect(lines).toEqual(["one", "two", "three"]);
        expect(result.code).toBe(0);

        const blocked: string[] = [];
        let ready: () => void = () => undefined;
        const started = new Promise<void>((resolve) => { ready = resolve; });
        const waiting = session.stream("mkfifo stay && echo waiting && read x < stay", (line) => {
            blocked.push(line);
            ready();
        });
        await started;
        waiting.cancel();
        const cancelled = await waiting.done;
        expect(cancelled.code).toBeNull();
        expect(blocked).toEqual(["waiting"]);
        // the connection still runs commands after a cancel
        expect((await session.exec("echo still here")).stdout).toBe("still here\n");
    });
});
