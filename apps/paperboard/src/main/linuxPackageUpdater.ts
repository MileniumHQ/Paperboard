// Updates a Paperboard installed from its own .deb or .rpm, the way
// electron-updater updates every other install: the new package downloads
// in the background, and "Restart to update" installs it and starts the new
// version. Installing a system package needs root, so the install runs
// through pkexec, which asks for the person's password the way the
// desktop's software center does.
//
// The package is checked against the release's SHA256SUMS (the list the
// install scripts read, packages/crane-launcher/install) before it is kept.
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { gt, valid } from "semver";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;

export type PackageType = "deb" | "rpm";

/** The command that installs a downloaded package, or null where this
 * machine has no tool for it. `which` answers whether a command exists. */
export function packageInstallCommand(type: PackageType, file: string, which: (cmd: string) => boolean): string[] | null {
    if (!which("pkexec")) return null;
    if (type === "deb") {
        if (which("apt-get")) return ["pkexec", "apt-get", "install", "-y", file];
        if (which("dpkg")) return ["pkexec", "dpkg", "-i", file];
        return null;
    }
    if (which("dnf")) return ["pkexec", "dnf", "install", "-y", file];
    if (which("zypper")) return ["pkexec", "zypper", "--non-interactive", "install", "--allow-unsigned-rpm", file];
    if (which("rpm")) return ["pkexec", "rpm", "-U", file];
    return null;
}

/** what pkexec's exit code means, for people */
export function pkexecFailure(code: number | null, tool: string): string {
    if (code === 126) return "The update wasn't installed: you didn't give permission to install it.";
    if (code === 127) return "The update wasn't installed: this computer couldn't ask you for permission (no authentication agent is running).";
    return `The update wasn't installed: ${tool} stopped with code ${code}.`;
}

/** whether a command is on PATH, as an executable file */
export function onPath(cmd: string, pathVar: string = process.env.PATH ?? ""): boolean {
    return pathVar.split(path.delimiter).some((dir) => {
        if (!dir) return false;
        const file = path.join(dir, cmd);
        // statSync without throwIfNoEntry answers undefined for a missing file
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        return Boolean(stat?.isFile() && (stat.mode & 0o111) !== 0);
    });
}

async function readText(url: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not check app updates: ${url} answered HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_TEXT_BYTES) throw new Error(`${url} is larger than it can be`);
    return text;
}

export interface LinuxPackageUpdaterOptions {
    currentVersion: string;
    feedUrl: string;
    /** https://i.paperboard.dev/pb */
    downloadBase: string;
    /** paperboard-linux-<arch>.<type> */
    file: string;
    type: PackageType;
    /** where the downloaded package waits to be installed */
    downloadDir: string;
    which: (cmd: string) => boolean;
}

export class LinuxPackageUpdater extends EventEmitter {
    private request: AbortController | null = null;
    private downloaded: { file: string; version: string } | null = null;

    constructor(private readonly opts: LinuxPackageUpdaterOptions) {
        super();
    }

    /** whether this machine can install the package itself */
    get canInstall(): boolean {
        return packageInstallCommand(this.opts.type, "x", this.opts.which) !== null;
    }

    async checkForUpdates(): Promise<{ downloadPromise: Promise<void> | null }> {
        const controller = new AbortController();
        this.request = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
        const info = parseUpdateInfo(await readText(this.opts.feedUrl, signal), path.basename(this.opts.feedUrl), new URL(this.opts.feedUrl));
        if (!valid(info.version) || !valid(this.opts.currentVersion)) throw new Error("The app update version is invalid");
        if (!gt(info.version, this.opts.currentVersion)) {
            this.request = null;
            this.emit("update-not-available", info);
            return { downloadPromise: null };
        }
        this.emit("update-available", info);
        const downloadPromise = this.download(info.version, controller).finally(() => {
            if (this.request === controller) this.request = null;
        });
        return { downloadPromise };
    }

    private async download(version: string, controller: AbortController): Promise<void> {
        const { downloadBase, file, downloadDir } = this.opts;
        const sums = await readText(`${downloadBase}/SHA256SUMS`, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        const expected = sums.split("\n").map((line) => line.trim().split(/\s+/)).find((parts) => parts[1] === file)?.[0];
        if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`The latest release lists no checksum for ${file}`);

        fs.mkdirSync(downloadDir, { recursive: true, mode: 0o755 });
        const target = path.join(downloadDir, file);
        const partial = `${target}.partial`;
        const response = await fetch(`${downloadBase}/latest/${file}`, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
        const total = Number(response.headers.get("content-length")) || 0;
        const hash = createHash("sha256");
        // the package manager reads it as its own user
        const out = fs.createWriteStream(partial, { mode: 0o644 });
        let transferred = 0;
        try {
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
                transferred += chunk.length;
                if (transferred > MAX_PACKAGE_BYTES) throw new Error(`${file} is larger than a Paperboard package can be`);
                hash.update(chunk);
                if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
                if (total) this.emit("download-progress", { percent: (transferred / total) * 100, transferred, total });
            }
        } finally {
            await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
        }
        const actual = hash.digest("hex");
        if (actual !== expected) {
            fs.rmSync(partial, { force: true });
            throw new Error(`The downloaded ${file} doesn't match its checksum (expected ${expected}, got ${actual})`);
        }
        fs.renameSync(partial, target);
        this.downloaded = { file: target, version };
        this.emit("update-downloaded", { version });
    }

    /** Installs the downloaded package; resolves once it is installed. */
    install(): Promise<void> {
        const downloaded = this.downloaded;
        if (!downloaded) return Promise.reject(new Error("No app update has been downloaded"));
        const command = packageInstallCommand(this.opts.type, downloaded.file, this.opts.which);
        if (!command) return Promise.reject(new Error(`This computer has no way to install a .${this.opts.type} package itself`));
        const [bin, ...args] = command as [string, ...string[]];
        return new Promise((resolve, reject) => {
            const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
            let stderr = "";
            child.stderr.on("data", (chunk: Buffer) => {
                if (stderr.length < MAX_TEXT_BYTES) stderr += chunk.toString("utf8");
            });
            child.once("error", (err) => reject(new Error(`The update wasn't installed: couldn't run ${bin} (${err.message})`)));
            child.once("exit", (code) => {
                if (code === 0) {
                    fs.rmSync(downloaded.file, { force: true });
                    resolve();
                    return;
                }
                const detail = stderr.trim().split("\n").slice(-3).join(" ");
                reject(new Error(`${pkexecFailure(code, args[0] ?? bin)}${detail && code !== 126 ? ` ${detail}` : ""}`));
            });
        });
    }

    cancel(): void {
        this.request?.abort();
    }
}
