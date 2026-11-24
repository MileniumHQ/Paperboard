// Reading the person's OpenSSH client config (`~/.ssh/config`) the way `ssh`
// does, for the settings setting up a computer needs: HostName, User, Port,
// IdentityFile, the known_hosts files and HostKeyAlias. Lines for other
// keywords are skipped unread. Of those, ProxyJump, ProxyCommand and
// CertificateFile do change how ssh connects, and aren't followed. Host blocks match the name the person typed (an
// alias), first value wins, IdentityFile adds up, and Include pulls other
// files in where it stands. Match blocks need state this doesn't have
// (exec, user, address), so their contents are skipped as a whole.
import * as fs from "fs";
import * as path from "path";
import { errorCode } from "@mileniumhq/paperapi/errors";

/** The keys `ssh` tries when the config names none, in its order. */
export const DEFAULT_IDENTITY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa"];

export interface SshTarget {
    /** the name to connect to: HostName, or the host itself */
    hostName: string;
    port: number;
    user: string;
    /** absolute paths of the keys to try, in order: the config's, else the defaults that exist */
    identityFiles: string[];
    /** where host keys are looked up: the person's files (a new key is added to the first) and the system's, read only */
    knownHosts: { user: string[]; global: string[] };
    /** HostKeyAlias: the name its host key is filed under instead of hostName and port */
    hostKeyAlias?: string;
}

export interface SshConfigOptions {
    sshDir: string;
    localUser: string;
}

interface RawSettings {
    hostName?: string;
    user?: string;
    port?: string;
    identityFiles: string[];
    userKnownHosts?: string[];
    globalKnownHosts?: string[];
    hostKeyAlias?: string;
}

// ssh's own defaults for the system's known_hosts
const GLOBAL_KNOWN_HOSTS = process.platform === "win32"
    ? [path.join(process.env.ProgramData ?? "C:\\ProgramData", "ssh", "ssh_known_hosts")]
    : ["/etc/ssh/ssh_known_hosts", "/etc/ssh/ssh_known_hosts2"];

// the keywords read here; any other line is passed over, as ssh's own options
const READ = new Set(["host", "match", "hostname", "user", "port", "identityfile", "include", "userknownhostsfile", "globalknownhostsfile", "hostkeyalias"]);

const MAX_INCLUDE_DEPTH = 16;

/** Resolves what `ssh <host>` would connect to, from `sshDir/config`. */
export function resolveSshTarget(host: string, options: SshConfigOptions): SshTarget {
    return resolveWithOverrides(host, options, {});
}

/** Like resolveSshTarget, with a port or user the person gave taking over the config's. */
export function resolveWithOverrides(
    host: string,
    options: SshConfigOptions,
    overrides: { port?: number; user?: string },
): SshTarget {
    const raw = readSettings(host, options.sshDir);
    const home = path.dirname(options.sshDir);
    const hostName = raw.hostName === undefined ? host : expandTokens(raw.hostName, { h: host, u: options.localUser, d: home }, "HostName");
    const user = overrides.user ?? raw.user ?? options.localUser;
    const port = overrides.port ?? (raw.port === undefined ? 22 : parsePort(raw.port));
    const tokens = { h: hostName, u: options.localUser, r: user, d: home };
    const identityFiles = raw.identityFiles.length > 0
        ? raw.identityFiles.map((file) => absolute(expandTokens(expandTilde(file, home), tokens, "IdentityFile"), options.sshDir))
        : DEFAULT_IDENTITY_FILES.map((name) => path.join(options.sshDir, name)).filter((file) => fs.existsSync(file));
    const files = (list: string[] | undefined, fallback: string[], keyword: string) =>
        list === undefined ? fallback : list.includes("none") ? [] : list.map((file) => absolute(expandTokens(expandTilde(file, home), tokens, keyword), options.sshDir));
    const knownHosts = {
        user: files(raw.userKnownHosts, [path.join(options.sshDir, "known_hosts"), path.join(options.sshDir, "known_hosts2")], "UserKnownHostsFile"),
        global: files(raw.globalKnownHosts, GLOBAL_KNOWN_HOSTS, "GlobalKnownHostsFile"),
    };
    return { hostName, port, user, identityFiles, knownHosts, ...(raw.hostKeyAlias === undefined ? {} : { hostKeyAlias: raw.hostKeyAlias }) };
}

function readSettings(host: string, sshDir: string): RawSettings {
    const settings: RawSettings = { identityFiles: [] };
    const file = path.join(sshDir, "config");
    if (!fs.existsSync(file)) return settings;
    applyFile(file, host.toLowerCase(), sshDir, settings, 0);
    return settings;
}

function applyFile(file: string, host: string, sshDir: string, settings: RawSettings, depth: number): void {
    if (depth > MAX_INCLUDE_DEPTH) throw new Error(`${file}: Include goes deeper than ${MAX_INCLUDE_DEPTH} files; is a file including itself?`);
    const text = fs.readFileSync(file, "utf8");
    // lines before the first Host or Match apply to every host
    let applies = true;
    text.split(/\r?\n/).forEach((line, index) => {
        const parsed = parseLine(line, `${file}:${index + 1}`);
        if (!parsed) return;
        const [keyword, args] = parsed;
        if (keyword === "host") {
            applies = hostMatches(host, args);
            return;
        }
        if (keyword === "match") {
            applies = false;
            return;
        }
        if (!applies) return;
        const value = args[0];
        switch (keyword) {
            case "hostname":
                settings.hostName ??= value;
                break;
            case "user":
                settings.user ??= value;
                break;
            case "port":
                settings.port ??= value;
                break;
            case "identityfile":
                settings.identityFiles.push(value);
                break;
            case "userknownhostsfile":
                settings.userKnownHosts ??= args;
                break;
            case "globalknownhostsfile":
                settings.globalKnownHosts ??= args;
                break;
            case "hostkeyalias":
                settings.hostKeyAlias ??= value;
                break;
            case "include":
                for (const pattern of args) {
                    for (const included of expandGlob(absolute(expandTilde(pattern, path.dirname(sshDir)), sshDir))) {
                        applyFile(included, host, sshDir, settings, depth + 1);
                    }
                }
                break;
        }
    });
}

/** A line's lowercased keyword and its arguments, or undefined for a blank or comment line. */
function parseLine(line: string, where: string): [string, string[]] | undefined {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return undefined;
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+|$)(.*)$/.exec(trimmed);
    if (!match) throw new Error(`${where}: can't read "${trimmed}" (expected a keyword and a value)`);
    const keyword = match[1].toLowerCase();
    if (!READ.has(keyword)) return undefined;
    const args = splitArgs(match[2], where);
    if (args.length === 0) throw new Error(`${where}: ${match[1]} has no value`);
    return [keyword, args];
}

function splitArgs(text: string, where: string): string[] {
    const args: string[] = [];
    let i = 0;
    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) break;
        if (text[i] === "#") break;
        if (text[i] === '"') {
            const end = text.indexOf('"', i + 1);
            if (end === -1) throw new Error(`${where}: a quote isn't closed`);
            args.push(text.slice(i + 1, end));
            i = end + 1;
        } else {
            let end = i;
            while (end < text.length && !/\s/.test(text[end])) end++;
            args.push(text.slice(i, end));
            i = end;
        }
    }
    return args;
}

/** OpenSSH host pattern lists: any positive pattern matches and no negated one does. */
export function hostMatches(host: string, patterns: string[]): boolean {
    let matched = false;
    for (const raw of patterns) {
        const negated = raw.startsWith("!");
        const pattern = (negated ? raw.slice(1) : raw).toLowerCase();
        if (!wildcardMatch(host.toLowerCase(), pattern)) continue;
        if (negated) return false;
        matched = true;
    }
    return matched;
}

/** `*` matches any run of characters, `?` exactly one; everything else is literal. */
export function wildcardMatch(text: string, pattern: string): boolean {
    let t = 0;
    let p = 0;
    let starP = -1;
    let starT = 0;
    while (t < text.length) {
        if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
            t++;
            p++;
        } else if (p < pattern.length && pattern[p] === "*") {
            starP = p++;
            starT = t;
        } else if (starP !== -1) {
            p = starP + 1;
            t = ++starT;
        } else {
            return false;
        }
    }
    while (p < pattern.length && pattern[p] === "*") p++;
    return p === pattern.length;
}

function parsePort(value: string): number {
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new Error(`The ssh config's Port "${value}" isn't a port number`);
    return port;
}

function expandTilde(value: string, home: string): string {
    if (value === "~") return home;
    if (value.startsWith("~/")) return path.join(home, value.slice(2));
    return value;
}

function expandTokens(value: string, tokens: Record<string, string>, keyword: string): string {
    return value.replace(/%(.)?/g, (whole, token: string | undefined) => {
        if (token === "%") return "%";
        const replacement = token === undefined ? undefined : tokens[token];
        if (replacement === undefined) throw new Error(`The ssh config's ${keyword} "${value}" uses ${whole}, which Paperboard doesn't expand`);
        return replacement;
    });
}

function absolute(file: string, sshDir: string): string {
    return path.isAbsolute(file) ? file : path.join(sshDir, file);
}

/** The files a path with `*` or `?` in its parts names, sorted as a shell would; a plain path as is if it exists. */
function expandGlob(pattern: string): string[] {
    const parsed = path.parse(pattern);
    const parts = pattern.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
    let found = [parsed.root];
    for (const [index, part] of parts.entries()) {
        const last = index === parts.length - 1;
        const next: string[] = [];
        for (const dir of found) {
            if (!/[*?]/.test(part)) {
                const candidate = path.join(dir, part);
                if (fs.existsSync(candidate)) next.push(candidate);
                continue;
            }
            for (const entry of listDir(dir)) {
                if (entry.startsWith(".") && !part.startsWith(".")) continue;
                if (!wildcardMatch(entry, part)) continue;
                const candidate = path.join(dir, entry);
                if (last || fs.statSync(candidate).isDirectory()) next.push(candidate);
            }
        }
        found = next.sort();
    }
    return found.filter((file) => fs.statSync(file).isFile());
}

function listDir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch (err) {
        // quiet: a glob over a folder that isn't there names no files, as in ssh
        if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return [];
        throw err;
    }
}
