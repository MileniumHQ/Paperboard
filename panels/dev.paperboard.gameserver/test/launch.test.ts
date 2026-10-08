// The launch record decides what java runs: argument files for NeoForge and
// modern Forge, a jar for everything else. Detection is exercised against
// folders laid out exactly as the real installers left them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    DEFAULT_LAUNCH,
    detectInstallerLaunch,
    javaLaunchArgs,
    launchEntryFile,
    parseLaunchSpec,
} from "../src/software/launch";
import { currentInstall, parseInstallRecord } from "../src/software/installRecord";

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-launch-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function touch(relative: string) {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
}
const exists = async (relative: string) => fs.existsSync(path.join(dir, ...relative.split("/")));

describe("detectInstallerLaunch", () => {
    test("modern Forge: argument files win over the shim jar", async () => {
        // forge-1.21.1-52.1.0 --installServer output
        touch("forge-1.21.1-52.1.0-shim.jar");
        touch("libraries/net/minecraftforge/forge/1.21.1-52.1.0/unix_args.txt");
        touch("libraries/net/minecraftforge/forge/1.21.1-52.1.0/win_args.txt");
        touch("run.sh");
        const spec = await detectInstallerLaunch(
            {
                argfileDir: "libraries/net/minecraftforge/forge/1.21.1-52.1.0",
                jars: ["forge-1.21.1-52.1.0.jar"],
            },
            exists,
        );
        expect(spec).toEqual({
            type: "argfile",
            unix: "libraries/net/minecraftforge/forge/1.21.1-52.1.0/unix_args.txt",
            windows: "libraries/net/minecraftforge/forge/1.21.1-52.1.0/win_args.txt",
        });
    });

    test("legacy Forge: the runnable jar", async () => {
        // forge-1.12.2-14.23.5.2860 --installServer output
        touch("forge-1.12.2-14.23.5.2860.jar");
        touch("minecraft_server.1.12.2.jar");
        fs.mkdirSync(path.join(dir, "libraries"));
        const spec = await detectInstallerLaunch(
            {
                argfileDir: "libraries/net/minecraftforge/forge/1.12.2-14.23.5.2860",
                jars: ["forge-1.12.2-14.23.5.2860.jar", "forge-1.12.2-14.23.5.2860-universal.jar"],
            },
            exists,
        );
        expect(spec).toEqual({ type: "jar", jar: "forge-1.12.2-14.23.5.2860.jar" });
    });

    test("one OS's argument file alone is not a complete install", async () => {
        touch("libraries/net/neoforged/neoforge/21.1.256/unix_args.txt");
        expect(
            await detectInstallerLaunch({ argfileDir: "libraries/net/neoforged/neoforge/21.1.256" }, exists),
        ).toBeNull();
    });
});

describe("java argv", () => {
    const argfile = parseLaunchSpec({
        type: "argfile",
        unix: "libraries/net/neoforged/neoforge/21.1.256/unix_args.txt",
        windows: "libraries/net/neoforged/neoforge/21.1.256/win_args.txt",
    })!;

    test("argument-file launch passes the OS's file to java", () => {
        expect(javaLaunchArgs(argfile, 6, false)).toEqual([
            "-Xmx6G",
            "-Xms6G",
            "@libraries/net/neoforged/neoforge/21.1.256/unix_args.txt",
            "nogui",
        ]);
        expect(javaLaunchArgs(argfile, 6, true)[2]).toBe("@libraries/net/neoforged/neoforge/21.1.256/win_args.txt");
        expect(launchEntryFile(argfile, true)).toBe("libraries/net/neoforged/neoforge/21.1.256/win_args.txt");
    });

    test("jar launch is unchanged from before launch records", () => {
        expect(javaLaunchArgs(DEFAULT_LAUNCH, 4, false)).toEqual(["-Xmx4G", "-Xms4G", "-jar", "server.jar", "nogui"]);
    });
});

describe("recorded launch is validated", () => {
    test("paths that leave the server folder are refused", () => {
        expect(parseLaunchSpec({ type: "jar", jar: "../../bin/evil.jar" })).toBeNull();
        expect(parseLaunchSpec({ type: "jar", jar: "/etc/evil.jar" })).toBeNull();
        expect(parseLaunchSpec({ type: "argfile", unix: "a/unix_args.txt", windows: "..\\win.txt" })).toBeNull();
        expect(parseLaunchSpec({ type: "shell", command: "sh" })).toBeNull();
    });

    test("an install record that claims user data is unreadable, not trusted", () => {
        const record = {
            software: "forge",
            version: "1.21.1",
            build: "52.1.0",
            launch: { type: "jar", jar: "server.jar" },
            files: ["libraries", "world"],
            staging: ".install-1-1",
        };
        expect(() => parseInstallRecord(record)).toThrow("unreadable");
    });

    test("configs from before install records launch server.jar and own only it", () => {
        expect(currentInstall({ software: "paper", version: "1.21.1" })).toEqual({
            record: null,
            launch: DEFAULT_LAUNCH,
            files: ["server.jar"],
        });
    });
});
