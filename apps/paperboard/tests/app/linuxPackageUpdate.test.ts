// A Paperboard installed from its own .deb or .rpm updates itself: it
// downloads the new package, keeps it only if it matches the release's
// SHA256SUMS, and installs it through pkexec with the system's own tool.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { LinuxPackageUpdater, packageInstallCommand, pkexecFailure } from "../../src/main/linuxPackageUpdater";
import { tempDir } from "../platform/app/support/temp";

const FILE = "paperboard-linux-x64.deb";
const PACKAGE = "the new package";

let server: http.Server;
let base: string;
let sums: string;
let feedVersion: string;
let dir: string;

beforeEach(async () => {
    dir = tempDir("package-update");
    feedVersion = "9.0.0";
    sums = `${crypto.createHash("sha256").update(PACKAGE).digest("hex")}  ${FILE}\n`;
    server = http.createServer((req, res) => {
        if (req.url === "/pb/latest-linux.yml") return void res.end(`version: ${feedVersion}\npath: x\nsha512: x\nfiles: []\n`);
        if (req.url === "/pb/SHA256SUMS") return void res.end(sums);
        if (req.url === `/pb/latest/${FILE}`) return void res.end(PACKAGE);
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pb`;
});

afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

function updater(): { updater: LinuxPackageUpdater; events: string[] } {
    const events: string[] = [];
    const u = new LinuxPackageUpdater({
        currentVersion: "1.0.0",
        feedUrl: `${base}/latest-linux.yml`,
        downloadBase: base,
        file: FILE,
        type: "deb",
        downloadDir: path.join(dir, "downloads"),
        which: () => true,
    });
    for (const event of ["update-available", "update-not-available", "update-downloaded"]) u.on(event, () => events.push(event));
    return { updater: u, events };
}

describe("a .deb or .rpm Paperboard updates itself", () => {
    test("a newer release downloads and is kept once it matches its checksum", async () => {
        const { updater: u, events } = updater();
        await (await u.checkForUpdates()).downloadPromise;
        expect(events).toEqual(["update-available", "update-downloaded"]);
        expect(fs.readFileSync(path.join(dir, "downloads", FILE), "utf8")).toBe(PACKAGE);
    });

    test("a package that doesn't match its checksum is thrown away, never installed", async () => {
        sums = `${"0".repeat(64)}  ${FILE}\n`;
        const { updater: u, events } = updater();
        const { downloadPromise } = await u.checkForUpdates();
        await expect(downloadPromise!).rejects.toThrow("doesn't match its checksum");
        expect(events).toEqual(["update-available"]);
        expect(fs.readdirSync(path.join(dir, "downloads"))).toEqual([]);
        await expect(u.install()).rejects.toThrow("No app update has been downloaded");
    });

    test("the current release downloads nothing", async () => {
        feedVersion = "1.0.0";
        const { updater: u, events } = updater();
        expect((await u.checkForUpdates()).downloadPromise).toBeNull();
        expect(events).toEqual(["update-not-available"]);
    });

    test("it installs with the system's own tool through pkexec, and says why when it can't", () => {
        const has = (...cmds: string[]) => (cmd: string) => cmds.includes(cmd);
        expect(packageInstallCommand("deb", "/d/p.deb", has("pkexec", "apt-get", "dpkg"))).toEqual(["pkexec", "apt-get", "install", "-y", "/d/p.deb"]);
        expect(packageInstallCommand("rpm", "/d/p.rpm", has("pkexec", "dnf"))).toEqual(["pkexec", "dnf", "install", "-y", "/d/p.rpm"]);
        expect(packageInstallCommand("rpm", "/d/p.rpm", has("pkexec", "zypper"))).toEqual(["pkexec", "zypper", "--non-interactive", "install", "--allow-unsigned-rpm", "/d/p.rpm"]);
        // without pkexec, or without a tool for the package, the person installs it
        expect(packageInstallCommand("deb", "/d/p.deb", has("apt-get"))).toBeNull();
        expect(packageInstallCommand("rpm", "/d/p.rpm", has("pkexec", "apt-get"))).toBeNull();
        expect(pkexecFailure(126, "apt-get")).toContain("didn't give permission");
        expect(pkexecFailure(100, "apt-get")).toContain("apt-get stopped with code 100");
    });
});
