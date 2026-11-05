// papercrane install-service / uninstall-service with the compiled binary.
// The service file must run the daemon with --headless and stop only the
// daemon process, so workloads outlive a restart. On Linux with a systemd
// user manager the whole cycle runs for real: install, the daemon answers,
// uninstall, the data stays.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compileCrane, tempDir } from "./craneDaemon";

const MAIN = path.resolve(import.meta.dir, "../papercrane/main.ts");
let root: string;
let bin: string;

beforeAll(async () => {
    root = tempDir("crane-service-");
    bin = await compileCrane(root);
}, 120_000);

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function crane(args: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
    const result = spawnSync(bin, args, { encoding: "utf8", env: { ...process.env, ...env } });
    return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

const supported = process.platform === "linux" || process.platform === "darwin";

describe.if(supported)("install-service --dry-run", () => {
    test("writes a headless service that leaves workloads running, and changes nothing", () => {
        const dataDir = path.join(root, "dry data");
        const { code, out, err } = crane(["install-service", "--dry-run", "--port", "45999", "--data-dir", dataDir, "--name", "papercrane-dry"]);
        expect(err).toBe("");
        expect(code).toBe(0);
        if (process.platform === "linux") {
            const unit = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", "papercrane-dry.service");
            expect(out).toContain(`Would write ${unit}`);
            // systemd's own quoting for a path with a space
            expect(out).toContain(`ExecStart=${bin} --headless --port 45999 --data-dir "${dataDir}"`);
            expect(out).toContain("KillMode=process");
            expect(out).toContain("OOMPolicy=continue");
            expect(out).toContain("WantedBy=default.target");
            expect(out).toContain("systemctl --user enable papercrane-dry.service");
            expect(fs.existsSync(unit)).toBe(false);
        } else {
            expect(out).toContain("<string>--headless</string>");
            expect(out).toContain("<key>AbandonProcessGroup</key>");
            expect(out).toContain("<string>dev.paperboard.papercrane-dry</string>");
        }
        expect(fs.existsSync(dataDir)).toBe(false);
    });

    test("a data directory chosen with PAPERBOARD_DIR goes into the service, and --data-dir wins over it", () => {
        const fromEnv = path.join(root, "env data");
        const fromFlag = path.join(root, "flag data");
        const viaEnv = crane(["install-service", "--dry-run", "--name", "papercrane-dry-env"], { PAPERBOARD_DIR: fromEnv });
        expect(viaEnv.err).toBe("");
        expect(viaEnv.code).toBe(0);
        const viaFlag = crane(["install-service", "--dry-run", "--name", "papercrane-dry-env", "--data-dir", fromFlag], { PAPERBOARD_DIR: fromEnv });
        expect(viaFlag.code).toBe(0);
        if (process.platform === "linux") {
            expect(viaEnv.out).toContain(`--data-dir "${fromEnv}"`);
            expect(viaEnv.out).toContain(`# Paperboard data: ${fromEnv}`);
            expect(viaFlag.out).toContain(`--data-dir "${fromFlag}"`);
            expect(viaFlag.out.includes(fromEnv)).toBe(false);
        } else {
            expect(viaEnv.out).toContain(`<string>${fromEnv}</string>`);
            expect(viaFlag.out).toContain(`<string>${fromFlag}</string>`);
            expect(viaFlag.out.includes(fromEnv)).toBe(false);
        }
        expect(fs.existsSync(fromEnv)).toBe(false);
    });

    test("a system service needs root", () => {
        if (process.getuid?.() === 0) return;
        const { code, err } = crane(["install-service", "--system", "--run-as", os.userInfo().username]);
        expect(code).toBe(1);
        expect(err).toContain("needs root");
    });

    test("--run-as without --system is a usage error", () => {
        const { code, err } = crane(["install-service", "--run-as", "someone"]);
        expect(code).toBe(2);
        expect(err).toContain("--run-as only applies to --system");
    });
});

test("a source checkout refuses, since bare bun cannot run supervisors", () => {
    const result = spawnSync(process.execPath, [MAIN, "install-service", "--dry-run"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("needs the compiled papercrane binary");
});

const userManager = process.platform === "linux" && spawnSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" }).status === 0;

describe.if(userManager)("a real systemd user service", () => {
    test("installs, runs the daemon, uninstalls and keeps the data", () => {
        const name = `papercrane-test-${process.pid}`;
        const dataDir = path.join(root, "service data");
        const unit = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", `${name}.service`);
        try {
            const install = crane(["install-service", "--name", name, "--host", "127.0.0.1", "--port", "0", "--data-dir", dataDir]);
            expect(install.err).toBe("");
            expect(install.code).toBe(0);
            expect(install.out).toContain(`Installed the Paperboard server daemon as a user service (${name}.service)`);
            expect(install.out).toContain(`journalctl --user -u ${name} -f`);

            const status = crane(["status", "--json", "--data-dir", dataDir]);
            expect(status.code).toBe(0);
            const running = JSON.parse(status.out);
            const mainPid = Number(spawnSync("systemctl", ["--user", "show", "--property=MainPID", "--value", `${name}.service`], { encoding: "utf8" }).stdout.trim());
            expect(running.pid).toBe(mainPid);

            const uninstall = crane(["uninstall-service", "--name", name]);
            expect(uninstall.err).toBe("");
            expect(uninstall.code).toBe(0);
            expect(fs.existsSync(unit)).toBe(false);
            expect(fs.existsSync(path.join(dataDir, "local"))).toBe(true);
            expect(crane(["status", "--data-dir", dataDir]).code).toBe(3);
        } finally {
            if (fs.existsSync(unit)) {
                spawnSync("systemctl", ["--user", "disable", "--now", `${name}.service`]);
                fs.rmSync(unit, { force: true });
                spawnSync("systemctl", ["--user", "daemon-reload"]);
            }
        }
    }, 60_000);
});
