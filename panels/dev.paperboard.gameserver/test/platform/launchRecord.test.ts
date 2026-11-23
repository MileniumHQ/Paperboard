import { describe, expect, test } from "bun:test";
import { parseLaunchSpec } from "../../src/software/launch";
import { parseInstallRecord } from "../../src/software/installRecord";
import { minecraftCalls } from "../../src/games/minecraft/calls";
import { testServer } from "../helpers/scope";

const NEO = "libraries/net/neoforged/neoforge/21.1.256";
const record = (launch: unknown, files: string[] = ["libraries"]) => ({
    software: "neoforge",
    version: "1.21.1",
    build: "21.1.256",
    launch,
    files,
    staging: ".install-1-1",
});

// The launch record is validated before anything runs.
describe("the launch record", () => {
    test("a jar or argfile path leaving the server folder, or an unknown launch type, is rejected", () => {
        for (const jar of ["../../bin/evil.jar", "/etc/evil.jar", "..\\evil.jar", "C:\\evil.jar", "libs//x.jar", "", "a/../../b.jar"]) {
            expect(parseLaunchSpec({ type: "jar", jar })).toBeNull();
            expect(parseLaunchSpec({ type: "argfile", unix: jar, windows: `${NEO}/win_args.txt` })).toBeNull();
            expect(parseLaunchSpec({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: jar })).toBeNull();
        }
        expect(parseLaunchSpec({ type: "shell", command: "rm -rf /" })).toBeNull();
        expect(parseLaunchSpec({ type: "jar", jar: "server.jar" })).toEqual({ type: "jar", jar: "server.jar" });
    });

    test("a record that owns user data or carries a forged launch is unreadable", () => {
        for (const files of [["world"], ["server.properties"], ["plugins"], ["libraries", "../outside"]]) {
            expect(() => parseInstallRecord(record({ type: "jar", jar: "server.jar" }, files))).toThrow("The recorded server install is unreadable");
        }
        expect(() => parseInstallRecord(record({ type: "jar", jar: "../../bin/evil.jar" }))).toThrow("unreadable");
        expect(parseInstallRecord(record({ type: "argfile", unix: `${NEO}/unix_args.txt`, windows: `${NEO}/win_args.txt` }))?.software).toBe("neoforge");
    });

    test("the generic config patch cannot set what an install records", async () => {
        const call = minecraftCalls.updatePanelConfig!;
        const scope = testServer({ directory: "servers/patch" });
        for (const key of ["software", "version", "install"]) {
            await expect(call(scope, { patch: { [key]: "forge" } })).rejects.toThrow(
                `"${key}" is set by installing a server version`,
            );
        }
    });
});
