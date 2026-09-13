// remote-folder mount credential hygiene (bun test): DAV session
// passwords never appear in spawn argv. Windows mounts via a static
// PowerShell script with the credential in child-only env; macOS mounts
// through a temp script file whose path (never its body) is the argv.
import { describe, it, expect } from "bun:test";
import {
    buildWindowsMountCommand,
    buildMacMountScript,
    macMountScriptPath,
} from "../src/main/remoteFolderMount";

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
});
