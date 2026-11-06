// remote-folder mount credential hygiene (bun test): DAV session
// passwords never appear in spawn argv. Windows mounts with no password via
// a static PowerShell script, the relay's secret path in child-only env
// (verified end to end on Windows 11 25H2: see davRelay's path mode); macOS mounts
// through a temp script file whose path (never its body) is the argv.
import { describe, it, expect } from "bun:test";
import {
    buildWindowsMountCommand,
    buildMacMountScript,
    macMountScriptPath,
    powershellErrorLine,
    remoteFolderSupported,
    windowsDavRoot,
} from "../src/main/remoteFolderMount";

// the real shell the Windows plan runs in (pwsh stands in off Windows)
const POWERSHELL = process.platform === "win32" ? Bun.which("powershell.exe") : Bun.which("pwsh");

const USER = "dav-user-9";
const PASS = "s3cr3t-p4ss-quake";

describe("remote folder mount credential hygiene", () => {
    it("windows argv carries no credential or secret path, env does", () => {
        const root = windowsDavRoot(45464, "/0123456789abcdef");
        expect(root).toBe("\\\\127.0.0.1@45464\\0123456789abcdef\\dav");
        const plan = buildWindowsMountCommand(root);
        const argvText = plan.args.join("\n");
        expect(argvText).not.toContain("0123456789abcdef");
        expect(plan.env.PB_DAV_ROOT).toBe(root);
        // Windows maps WebDAV with net use, after starting its WebDAV client by
        // the trigger ordinary users may fire; New-PSDrive refuses an http root
        expect(argvText).toContain("net.exe use");
        expect(argvText).toContain("22b6d684-fa63-4578-87c9-effcbe6643c7");
        expect(argvText).not.toContain("New-PSDrive");
        expect(() => windowsDavRoot(1, "")).toThrow(/secret/);
        expect(() => windowsDavRoot(1, "/dav")).toThrow(/secret/);
    });

    it("macOS mount body is file content, and the temp path leaks nothing", () => {
        const body = buildMacMountScript(USER, PASS, "192.168.1.2", 45464);
        expect(body).toContain(USER);
        expect(body).toContain(PASS);
        const scriptPath = macMountScriptPath();
        expect(scriptPath).not.toContain(PASS);
        expect(scriptPath).not.toContain(USER);
        expect(scriptPath.endsWith(".scpt")).toBe(true);
        // AppleScript string escapes: no raw quote can break the mount line
        const tricky = buildMacMountScript('a"b', "c\\d", "h", 1);
        expect(tricky).toContain('a\\"b');
        expect(tricky).toContain("c\\\\d");
    });

    it("opens remote folders only where the credential stays out of argv", () => {
        expect(remoteFolderSupported("win32")).toBe(true);
        expect(remoteFolderSupported("darwin")).toBe(true);
        expect(remoteFolderSupported("linux")).toBe(true);
        expect(remoteFolderSupported("freebsd")).toBe(false);
    });

    // a drive that never mapped must fail the plan: a printed letter sent
    // Explorer to a drive that wasn't there, and it opened Documents
    it.skipIf(!POWERSHELL)("windows plan fails, with no drive letter, when the mount fails", () => {
        const plan = buildWindowsMountCommand(windowsDavRoot(1, "/0123456789abcdef"));
        const run = Bun.spawnSync([POWERSHELL!, ...plan.args], {
            env: { ...process.env, ...plan.env },
            timeout: 60_000,
        });
        expect(run.exitCode).not.toBe(0);
        expect(run.stdout.toString()).not.toMatch(/[A-Z]:/);
        expect(powershellErrorLine(run.stderr.toString())).not.toBe("");
    });

    it("reads the first line of a PowerShell error without colour or cmdlet", () => {
        const raw = "\x1b[31;1mNew-PSDrive: \x1b[31;1mThe network path was not found.\x1b[0m\nAt line:1 char:5";
        expect(powershellErrorLine(raw)).toBe("The network path was not found.");
        expect(powershellErrorLine("New-PSDrive : Access is denied\r\n+ CategoryInfo")).toBe("Access is denied");
        expect(powershellErrorLine("")).toBe("");
    });
});
