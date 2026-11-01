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
    jvmFlags,
    type JvmTuning,
    launchEntryFile,
    parseLaunchSpec,
} from "../src/software/launch";
import { currentInstall, parseInstallRecord } from "../src/software/installRecord";
import { javaMajorOf, transparentHugePages } from "../src/games/minecraft/launch";

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

    const java21 = { ramGb: 6, javaMajor: 21, hugePages: false };

    test("argument-file launch passes the OS's file to java", () => {
        const args = javaLaunchArgs(argfile, java21, false);
        expect(args.slice(0, 2)).toEqual(["-Xmx6144M", "-Xms6144M"]);
        expect(args.slice(-2)).toEqual(["@libraries/net/neoforged/neoforge/21.1.256/unix_args.txt", "nogui"]);
        expect(javaLaunchArgs(argfile, java21, true).at(-2)).toBe("@libraries/net/neoforged/neoforge/21.1.256/win_args.txt");
        expect(launchEntryFile(argfile, true)).toBe("libraries/net/neoforged/neoforge/21.1.256/win_args.txt");
    });

    test("a jar launch runs the recorded jar after the JVM's tuning", () => {
        const args = javaLaunchArgs(DEFAULT_LAUNCH, { ...java21, ramGb: 4 }, false);
        expect(args.slice(0, 3)).toEqual(["-Xmx4096M", "-Xms4096M", "-XX:+UseG1GC"]);
        expect(args.slice(-3)).toEqual(["-jar", "server.jar", "nogui"]);
    });

    test("memory in tenths of a gigabyte is a whole number of megabytes", () => {
        expect(javaLaunchArgs(DEFAULT_LAUNCH, { ...java21, ramGb: 2.5 }, false).slice(0, 2)).toEqual(["-Xmx2560M", "-Xms2560M"]);
        // 0.1 steps drift in floating point: 0.7 * 1024 is 716.8000000000001
        expect(javaLaunchArgs(DEFAULT_LAUNCH, { ...java21, ramGb: 0.7 }, false)[0]).toBe("-Xmx717M");
    });
});

describe("JVM tuning", () => {
    const flags = (tuning: Partial<JvmTuning>) => jvmFlags({ ramGb: 6, javaMajor: 21, hugePages: false, ...tuning });

    test("Aikar's flags, with the larger young generation over 12 GB", () => {
        expect(flags({})).toContain("-XX:G1HeapRegionSize=8M");
        expect(flags({})).toContain("-XX:G1NewSizePercent=30");
        expect(flags({ ramGb: 16 })).toContain("-XX:G1HeapRegionSize=16M");
        expect(flags({ ramGb: 16 })).toContain("-XX:G1NewSizePercent=40");
        expect(flags({ ramGb: 12 })).toContain("-XX:G1NewSizePercent=30");
        for (const flag of ["-XX:+UseG1GC", "-XX:+AlwaysPreTouch", "-XX:+DisableExplicitGC", "-XX:MaxTenuringThreshold=1"]) expect(flags({})).toContain(flag);
    });

    test("compact object headers only on Java 25 and later, huge pages only where offered", () => {
        expect(flags({ javaMajor: 21 })).not.toContain("-XX:+UseCompactObjectHeaders");
        expect(flags({ javaMajor: 25 })).toContain("-XX:+UseCompactObjectHeaders");
        expect(flags({})).not.toContain("-XX:+UseTransparentHugePages");
        expect(flags({ hugePages: true })).toContain("-XX:+UseTransparentHugePages");
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

describe("transparent huge pages", () => {
    const write = (text: string) => {
        const file = path.join(dir, "enabled");
        fs.writeFileSync(file, text);
        return file;
    };

    test("the bracketed mode decides", async () => {
        expect(await transparentHugePages(write("always [madvise] never\n"))).toBe(true);
        expect(await transparentHugePages(write("[always] madvise never\n"))).toBe(true);
        expect(await transparentHugePages(write("always madvise [never]\n"))).toBe(false);
    });

    test("a kernel without them has no file", async () => {
        expect(await transparentHugePages(path.join(dir, "missing"))).toBe(false);
    });

    test("the Java major comes from the runtime package", () => {
        expect(javaMajorOf("java-8")).toBe(8);
        expect(javaMajorOf("java-25")).toBe(25);
        expect(() => javaMajorOf("node-22")).toThrow();
    });
});
