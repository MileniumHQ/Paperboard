// install.sh for real, on Linux: the AppImage install a distro without apt,
// dnf or zypper gets, from a loopback downloads server, into a throwaway
// HOME. It must refuse a download that doesn't match its checksum, and the
// launcher must find what it installed. npm's postinstall runs the same
// script, except when npx installs the package (npx asks first).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as path from "path";
import { findInstalledApp } from "../../src/app";
import { tempDir } from "../helpers/release";

const INSTALL_DIR = path.join(import.meta.dir, "..", "..", "install");
const FILE = `paperboard-linux-${process.arch === "arm64" ? "arm64" : "x64"}.AppImage`;
const ICON = "usr/share/icons/hicolor/512x512/apps/paperboard.png";

// stands in for the AppImage: it can hand out its icon, as a real one does
const FAKE_APPIMAGE = `#!/bin/sh
if [ "$1" = --appimage-extract ]; then mkdir -p "squashfs-root/$(dirname "$2")" && printf 'icon' > "squashfs-root/$2"; exit 0; fi
exit 0
`;

let work: string;
let home: string;
let server: http.Server;
let base: string;
let sums: string;

beforeEach(async () => {
    work = tempDir("install-app");
    home = path.join(work, "home");
    fs.mkdirSync(home);
    sums = `${crypto.createHash("sha256").update(FAKE_APPIMAGE).digest("hex")}  ${FILE}\n`;
    server = http.createServer((req, res) => {
        if (req.url === "/pb/SHA256SUMS") return void res.end(sums);
        if (req.url === `/pb/latest/${FILE}`) return void res.end(FAKE_APPIMAGE);
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pb`;
});

afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(work, { recursive: true, force: true });
});

interface Run {
    status: number | null;
    stderr: string;
}

// async, so this process's downloads server can answer the script
function run(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: environment, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.once("error", reject);
        child.once("close", (status) => resolve({ status, stderr }));
    });
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const next: NodeJS.ProcessEnv = { ...process.env, HOME: home, PAPERBOARD_DOWNLOADS: base, PAPERBOARD_INSTALL_AS: "appimage", ...extra };
    delete next.XDG_DATA_HOME;
    return next;
}

const installed = () => path.join(home, ".local", "share", "paperboard", "Paperboard.AppImage");

describe.if(process.platform === "linux")("installing Paperboard on Linux", () => {
    test("the AppImage, its menu entry, its icon and the paperboard command, where the launcher looks", async () => {
        const done = await run("sh", [path.join(INSTALL_DIR, "install.sh")], env());
        expect(done.stderr).toBe("");
        expect(done.status).toBe(0);
        expect(fs.readFileSync(installed(), "utf8")).toBe(FAKE_APPIMAGE);
        expect(fs.statSync(installed()).mode & 0o111).not.toBe(0);
        const entry = fs.readFileSync(path.join(home, ".local", "share", "applications", "paperboard.desktop"), "utf8");
        expect(entry).toContain(`Exec="${installed()}" --no-sandbox %U`);
        expect(fs.readFileSync(path.join(home, ".local", "share", "icons", "hicolor", "512x512", "apps", "paperboard.png"), "utf8")).toBe("icon");
        expect(fs.readlinkSync(path.join(home, ".local", "bin", "paperboard"))).toBe(installed());
        const app = findInstalledApp("linux", {}, home);
        // a computer with Paperboard's .deb or .rpm finds that one first
        if (!fs.existsSync("/opt/Paperboard/paperboard")) expect(app?.where).toBe(installed());
    });

    test("a download that doesn't match its checksum installs nothing", async () => {
        sums = `${"0".repeat(64)}  ${FILE}\n`;
        const done = await run("sh", [path.join(INSTALL_DIR, "install.sh")], env());
        expect(done.status).not.toBe(0);
        expect(done.stderr).toContain("doesn't match its checksum");
        expect(fs.existsSync(installed())).toBe(false);
    });

    test("npm install runs it; npx installing the package doesn't, and neither does this repository", async () => {
        // the package as npm lays it out
        const pkgDir = path.join(work, "node_modules", "@mileniumhq", "paperboard", "install");
        fs.mkdirSync(pkgDir, { recursive: true });
        for (const file of fs.readdirSync(INSTALL_DIR)) fs.copyFileSync(path.join(INSTALL_DIR, file), path.join(pkgDir, file));
        const postinstall = (dir: string, npmCommand: string) =>
            run("node", [path.join(dir, "postinstall.mjs")], env({ npm_command: npmCommand }));

        expect((await postinstall(pkgDir, "exec")).status).toBe(0);
        expect((await postinstall(INSTALL_DIR, "install")).status).toBe(0);
        expect(fs.existsSync(installed())).toBe(false);

        const done = await postinstall(pkgDir, "install");
        expect(done.stderr).toBe("");
        expect(done.status).toBe(0);
        expect(fs.existsSync(installed())).toBe(true);
    });
});
