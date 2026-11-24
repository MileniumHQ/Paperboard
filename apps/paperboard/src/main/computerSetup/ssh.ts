// Signing in to another computer over SSH to set Paperboard up there, the way
// the person's own `ssh` would: their ssh config's aliases, their agent and
// keys, then the password they typed (if any), and their known_hosts under
// `StrictHostKeyChecking accept-new`. A host key that changed stops the
// connection before any credential is sent. The password is used for this
// one connection and is never stored or logged.
import * as fs from "fs";
import * as path from "path";
import { Client, utils, type AnyAuthMethod, type AuthenticationType, type ClientChannel, type ConnectConfig, type KeyboardInteractiveCallback, type NextAuthHandler, type ParsedKey, type Prompt, type ServerHostKeyAlgorithm } from "ssh2";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { appendKnownHost, checkHostKey, fingerprintOf, knownHostName, knownKeyTypes, readKnownHosts } from "./knownHosts";
import { resolveWithOverrides } from "./sshConfig";

export class SshHostKeyChanged extends Error {
    constructor(
        message: string,
        /** the fingerprint of the key the host presented */
        readonly fingerprint: string,
    ) {
        super(message);
        this.name = "SshHostKeyChanged";
    }
}

/** The agent and keys were refused and no password was given. */
export class SshSignInNeeded extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SshSignInNeeded";
    }
}

/** A password was given and refused. */
export class SshPasswordRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SshPasswordRefused";
    }
}

/** No connection, no answer in time, or not an SSH server. */
export class SshUnreachable extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SshUnreachable";
    }
}

export interface SshExecResult {
    /** the exit code; null when the command ended by a signal or the server didn't say */
    code: number | null;
    stdout: string;
    stderr: string;
}

export interface SshSession {
    /** the host name connected to: the ssh config's HostName, or the host as given */
    readonly host: string;
    /** the account it signed in as */
    readonly username: string;
    /** "SHA256:..." of the host key */
    readonly hostKeyFingerprint: string;
    /** runs one command; stdin (if any) is written then closed. Rejects only on transport failure, never on a non-zero exit. */
    exec(command: string, options?: { stdin?: Buffer | string; timeoutMs?: number }): Promise<SshExecResult>;
    /** runs a long command, calling onLine for each stdout line as it arrives; cancel() closes the channel */
    stream(command: string, onLine: (line: string) => void): { done: Promise<SshExecResult>; cancel(): void };
    close(): void;
}

export interface OpenSshOptions {
    /** what the person typed or picked; also looked up as a Host alias in the ssh config */
    host: string;
    /** overrides the config; default the config's Port or 22 */
    port?: number;
    /** overrides the config; default the config's User or localUser */
    username?: string;
    /** used once for this connection, never stored or logged */
    password?: string;
    /** ~/.ssh normally: config, known_hosts and id_* live here */
    sshDir: string;
    /** os.userInfo().username normally */
    localUser: string;
    /** agent socket or pipe; undefined = the system's agent; null = no agent */
    agent?: string | null;
    /** default 10_000 */
    readyTimeoutMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const WINDOWS_AGENT_PIPE = "\\\\.\\pipe\\openssh-ssh-agent";

// The host key algorithms that produce a key of each known_hosts type.
const HOST_KEY_ALGORITHMS: Record<string, string[]> = {
    "ssh-ed25519": ["ssh-ed25519"],
    "ecdsa-sha2-nistp256": ["ecdsa-sha2-nistp256"],
    "ecdsa-sha2-nistp384": ["ecdsa-sha2-nistp384"],
    "ecdsa-sha2-nistp521": ["ecdsa-sha2-nistp521"],
    "ssh-rsa": ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"],
};

export async function openSsh(options: OpenSshOptions): Promise<SshSession> {
    const target = resolveWithOverrides(options.host, options, { port: options.port, user: options.username });
    const { hostName, port, user: username } = target;
    const where = port === 22 ? hostName : `${hostName}:${port}`;
    const knownHostsFile = path.join(options.sshDir, "known_hosts");
    const known = readKnownHosts(knownHostsFile);
    const methods = authMethods(username, systemAgent(options.agent), loadKeys(target.identityFiles), options.password);
    const preferred = knownKeyTypes(known, hostName, port).flatMap((type) => HOST_KEY_ALGORITHMS[type] ?? []) as ServerHostKeyAlgorithm[];

    const client = new Client();
    let hostKeyFingerprint: string | undefined;
    let refusal: Error | undefined;
    let passwordTried = false;
    let methodIndex = 0;

    const config: ConnectConfig = {
        host: hostName,
        port,
        username,
        readyTimeout: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        // ask for a key of a type known_hosts has, as ssh does (remove runs before prepend, which skips listed ones), so a host with several keys isn't taken for changed
        algorithms: preferred.length > 0 ? { serverHostKey: { remove: preferred, prepend: preferred, append: [] } } : undefined,
        hostVerifier: (key: Buffer): boolean => {
            const fingerprint = fingerprintOf(key);
            hostKeyFingerprint = fingerprint;
            try {
                const check = checkHostKey(readKnownHosts(knownHostsFile), hostName, port, key);
                if (check.kind === "known") return true;
                if (check.kind === "new") {
                    appendKnownHost(knownHostsFile, hostName, port, key);
                    return true;
                }
                const reason = check.kind === "revoked"
                    ? `The host key of ${where} (${fingerprint}) is marked revoked in known_hosts`
                    : `The host key of ${where} changed: known_hosts has a different ${check.knownTypes.join("/")} key, and it presented ${fingerprint}`;
                refusal = new SshHostKeyChanged(`${reason}. Setup stopped, so nothing was sent. If the computer was reinstalled, remove its line from ${knownHostsFile} (ssh-keygen -R ${knownHostName(hostName, port)}) and try again.`, fingerprint);
            } catch (err) {
                // quiet: the error is the connection's outcome, rejected below
                refusal = err instanceof Error ? err : new Error(errorMessage(err));
            }
            return false;
        },
        authHandler: (methodsLeft: AuthenticationType[] | null, _partial: boolean | null, next: NextAuthHandler) => {
            while (methodIndex < methods.length) {
                const method = methods[methodIndex++];
                const offered = methodsLeft === null || methodsLeft.includes(method.type);
                if (!offered) continue;
                if (method.type === "password" || method.type === "keyboard-interactive") passwordTried = true;
                return next(method);
            }
            refusal = signInRefusal(where, username, options.password !== undefined, passwordTried);
            return (next as (auth: AnyAuthMethod | false) => void)(false);
        },
    };

    return await new Promise<SshSession>((resolve, reject) => {
        let settled = false;
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            // a failed connection has nothing to end politely; drop the socket so nothing is left open
            client.destroy();
            reject(err);
        };
        client.on("error", (err: Error & { level?: string }) => {
            if (settled) return;
            // an agent that isn't running or a key the server can't use: ssh2 moves on to the next method
            if (err.level === "agent") return;
            if (err.level === "client-authentication" && refusal === undefined) return;
            fail(refusal ?? connectFailure(where, err, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS));
        });
        client.on("close", () => fail(refusal ?? new SshUnreachable(`${where} closed the connection before signing in finished`)));
        client.on("ready", () => {
            if (settled) return;
            settled = true;
            if (hostKeyFingerprint === undefined) {
                client.end();
                reject(new Error(`Signed in to ${where} without checking its host key`));
                return;
            }
            resolve(createSession(client, hostName, where, username, hostKeyFingerprint));
        });
        client.connect(config);
    });
}

function systemAgent(agent: string | null | undefined): string | undefined {
    if (agent === null) return undefined;
    if (agent !== undefined) return agent;
    if (process.platform === "win32") return fs.existsSync(WINDOWS_AGENT_PIPE) ? WINDOWS_AGENT_PIPE : "pageant";
    const socket = process.env.SSH_AUTH_SOCK;
    return socket ? socket : undefined;
}

/** The private keys that can be used without a passphrase; an encrypted one is left to the agent. */
function loadKeys(files: string[]): ParsedKey[] {
    const keys: ParsedKey[] = [];
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const parsed = utils.parseKey(fs.readFileSync(file));
        if (parsed instanceof Error) {
            if (/no passphrase given/i.test(parsed.message)) continue;
            throw new Error(`Couldn't read the SSH key ${file}: ${parsed.message}`);
        }
        const key = Array.isArray(parsed) ? (parsed[0] as ParsedKey) : parsed;
        if (key.isPrivateKey()) keys.push(key);
    }
    return keys;
}

function authMethods(username: string, agent: string | undefined, keys: ParsedKey[], password: string | undefined): AnyAuthMethod[] {
    const methods: AnyAuthMethod[] = [];
    if (agent !== undefined) methods.push({ type: "agent", username, agent });
    for (const key of keys) methods.push({ type: "publickey", username, key });
    if (password !== undefined) {
        methods.push({ type: "password", username, password });
        let rounds = 0;
        methods.push({
            type: "keyboard-interactive",
            username,
            // the first round is the password prompt; a later one (a one-time code) isn't something this can answer
            prompt: (_name: string, _instructions: string, _lang: string, prompts: Prompt[], finish: KeyboardInteractiveCallback) => {
                rounds++;
                finish(prompts.map(() => (rounds === 1 ? password : "")));
            },
        });
    }
    return methods;
}

function signInRefusal(where: string, username: string, passwordGiven: boolean, passwordTried: boolean): Error {
    if (!passwordGiven) return new SshSignInNeeded(`${where} didn't accept any SSH key for ${username}. Enter the password for ${username} to sign in.`);
    if (!passwordTried) return new SshPasswordRefused(`${where} doesn't take passwords for ${username}, only SSH keys. Add your key to its authorized_keys, or turn on password sign-in there.`);
    return new SshPasswordRefused(`${where} refused the password for ${username}.`);
}

function connectFailure(where: string, err: Error & { level?: string }, timeoutMs: number): Error {
    const code = errorCode(err);
    if (err.level === "client-timeout") return new SshUnreachable(`Couldn't reach ${where}: it didn't answer within ${Math.round(timeoutMs / 1000)} seconds`);
    if (err.level === "client-socket") {
        const reason: Record<string, string> = {
            ECONNREFUSED: "connection refused (is SSH turned on there?)",
            ENOTFOUND: "no computer by that name was found",
            EAI_AGAIN: "its name couldn't be looked up",
            EHOSTUNREACH: "the computer can't be reached from this network",
            ENETUNREACH: "the network can't be reached",
            ETIMEDOUT: "the connection timed out",
            ECONNRESET: "the connection was reset",
        };
        return new SshUnreachable(`Couldn't reach ${where}: ${(code && reason[code]) ?? errorMessage(err)}`);
    }
    if (err.level === "protocol" || /identification/i.test(err.message)) return new SshUnreachable(`${where} answered, but it isn't an SSH server (${errorMessage(err)})`);
    return new Error(`Couldn't connect to ${where} over SSH: ${errorMessage(err)}`);
}

function createSession(client: Client, host: string, where: string, username: string, hostKeyFingerprint: string): SshSession {
    let lost: Error | undefined;
    const pending = new Set<(err: Error) => void>();
    const loseConnection = (err: Error) => {
        lost ??= err;
        for (const abort of [...pending]) abort(lost);
    };
    client.on("error", (err: Error) => loseConnection(new Error(`The SSH connection to ${where} failed: ${errorMessage(err)}`)));
    client.on("close", () => loseConnection(new Error(`The SSH connection to ${where} closed`)));

    // runs a command on its own channel; resolves on the channel's close with what it said
    const run = (command: string, stdin: Buffer | string | undefined, onStdout: ((chunk: Buffer) => void) | undefined, timeoutMs: number | undefined) => {
        let channel: ClientChannel | undefined;
        let closeChannel = false;
        const done = new Promise<SshExecResult>((resolve, reject) => {
            if (lost) return reject(lost);
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let code: number | null = null;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const settle = (err: Error | undefined) => {
                if (!pending.delete(abort)) return;
                clearTimeout(timer);
                if (err) {
                    channel?.close();
                    reject(err);
                } else {
                    resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
                }
            };
            const abort = (err: Error) => settle(err);
            pending.add(abort);
            if (timeoutMs !== undefined) {
                timer = setTimeout(() => settle(new Error(`"${command}" on ${where} didn't finish within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
            }
            client.exec(command, (err, opened) => {
                if (err) return settle(new Error(`Couldn't run a command on ${where}: ${errorMessage(err)}`));
                channel = opened;
                if (!pending.has(abort) || closeChannel) {
                    opened.close();
                    if (closeChannel) settle(undefined);
                    return;
                }
                opened.on("data", (chunk: Buffer) => {
                    stdout.push(chunk);
                    if (!onStdout) return;
                    try {
                        onStdout(chunk);
                    } catch (callbackErr) {
                        // quiet: the callback's failure is the command's outcome
                        settle(callbackErr instanceof Error ? callbackErr : new Error(errorMessage(callbackErr)));
                    }
                });
                opened.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
                opened.on("exit", (exitCode: number | null) => {
                    code = typeof exitCode === "number" ? exitCode : null;
                });
                opened.on("close", () => {
                    // a channel closed by a dropped connection didn't finish; the connection's close reports that
                    setImmediate(() => settle(lost));
                });
                opened.end(stdin);
            });
        });
        const cancel = () => {
            closeChannel = true;
            channel?.close();
        };
        return { done, cancel };
    };

    return {
        host,
        username,
        hostKeyFingerprint,
        exec(command, execOptions) {
            return run(command, execOptions?.stdin, undefined, execOptions?.timeoutMs).done;
        },
        stream(command, onLine) {
            const decoder = new TextDecoder();
            let partial = "";
            const emit = (text: string) => {
                partial += text;
                const lines = partial.split("\n");
                partial = lines.pop() ?? "";
                for (const line of lines) onLine(line.replace(/\r$/, ""));
            };
            const running = run(command, undefined, (chunk) => emit(decoder.decode(chunk, { stream: true })), undefined);
            const done = running.done.then((result) => {
                emit(decoder.decode());
                if (partial !== "") onLine(partial.replace(/\r$/, ""));
                partial = "";
                return result;
            });
            return { done, cancel: running.cancel };
        },
        close() {
            client.end();
        },
    };
}
