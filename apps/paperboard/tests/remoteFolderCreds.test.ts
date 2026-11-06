// remote-folder mount credential hygiene (bun test): DAV session
// passwords never appear in spawn argv. Windows mounts via a static
// PowerShell script with the credential in child-only env; macOS mounts
// through a temp script file whose path (never its body) is the argv.
import { describe, it, expect } from "bun:test";
import {
    buildWindowsMountCommand,
    buildMacMountScript,
    macMountScriptPath,
    powershellErrorLine,
    remoteFolderSupported,
} from "../src/main/remoteFolderMount";

// the real shell the Windows plan runs in (pwsh stands in off Windows)
const POWERSHELL = process.platform === "win32" ? Bun.which("powershell.exe") : Bun.which("pwsh");

const USER = "dav-user-9";
const PASS = "s3cr3t-p4ss-quake";

describe("remote folder mount credential hygiene", () => {
    it("windows argv carries no credential, env does", () => {
        const plan = buildWindowsMountCommand("http://192.168.1.2:45464/dav", USER, PASS);
        const argvText = plan.args.join("\n");
        expect(argvText).not.toContain(PASS);
        expect(argvText).not.toContain(USER);
        expect(plan.env.PB_DAV_USER).toBe(USER);
        expect(plan.env.PB_DAV_PASS).toBe(PASS);
        // still a real mount plan: persistent drive, credential object
        expect(argvText).toContain("New-PSDrive");
        expect(argvText).toContain("-Persist");
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
        const plan = buildWindowsMountCommand("http://127.0.0.1:1/dav", USER, PASS);
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
