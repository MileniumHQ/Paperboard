// Service-boundary proofs (bun test): ports, level names, player names and
// trash paths are validated before they reach a command or the disk.
import { describe, test, expect } from "bun:test";
import { assertPort, listeningPidsCommand, parseListeningPids } from "../src/core/diagnostics";
import { killConflictingProcessWith, type KillPortDeps } from "../src/service/diagnostics";
import { getWorldDirsToDelete, assertShellSafeLevelName } from "../src/core/worlds";
import { trashRemovePathsWith } from "../src/service/trash";
import { isWindowsTarget } from "../src/lib/platform";
import { assertPlayerName, assertSingleLine } from "../src/core/players";

function killDeps(opts: { isWin?: boolean; output?: string; exitCode?: number } = {}) {
    const runs: { command: string; args: string[] }[] = [];
    const killed: number[] = [];
    const deps: KillPortDeps = {
        isWindows: async () => opts.isWin ?? false,
        run: async (command, args, onStdout) => {
            runs.push({ command, args });
            if (opts.output) onStdout(opts.output);
            return opts.exitCode ?? 0;
        },
        kill: (pid) => killed.push(pid),
        ownPid: 4242,
    };
    return { deps, runs, killed };
}

describe("assertPort", () => {
    test("accepts plain numeric ports", () => {
        expect(assertPort("25565")).toBe("25565");
        expect(assertPort(" 443 ")).toBe("443");
    });

    test("refuses shell syntax, empties, and out-of-range values", () => {
        for (const bad of ["25565; rm -rf /", "80 && evil", "", "0", "65536", "abc", undefined, "1.5", "-1"]) {
            expect(() => assertPort(bad)).toThrow(/Refusing/);
        }
    });
});

describe("killConflictingProcessWith", () => {
    test("a UI-supplied injection never reaches a command", async () => {
        const { deps, runs, killed } = killDeps();
        await expect(killConflictingProcessWith(deps, "25565; touch /tmp/pwned")).rejects.toThrow(
            /Refusing/,
        );
        expect(runs).toEqual([]);
        expect(killed).toEqual([]);
    });

    test("kills each listener lsof reports, never this service", async () => {
        const { deps, runs, killed } = killDeps({ output: "311\n4242\n311\n977\n" });
        expect(await killConflictingProcessWith(deps, "25565")).toBe(2);
        expect(runs).toEqual([{ command: "lsof", args: ["-t", "-iTCP:25565", "-sTCP:LISTEN"] }]);
        expect(killed).toEqual([311, 977]);
    });

    test("nothing listening is a valid answer, not a failure", async () => {
        // lsof exits 1 with no output when nothing matches
        const { deps, killed } = killDeps({ exitCode: 1 });
        expect(await killConflictingProcessWith(deps, "25565")).toBe(0);
        expect(killed).toEqual([]);
    });

    test("a lookup that could not run fails instead of reporting a kill", async () => {
        const { deps } = killDeps({ isWin: true, exitCode: 1 });
        await expect(killConflictingProcessWith(deps, "25565")).rejects.toThrow(/Could not look up/);
    });

    test("windows asks PowerShell as one argv element, not a typed shell line", async () => {
        // the old command was typed into a PowerShell pty as
        // powershell -Command "... $_ ...": the outer shell expanded $_ to
        // nothing inside the double quotes, so the kill never ran
        const { deps, runs, killed } = killDeps({ isWin: true, output: "0\r\n5120\r\n" });
        expect(await killConflictingProcessWith(deps, "25565")).toBe(1);
        expect(runs[0].command).toBe("powershell.exe");
        expect(runs[0].args.at(-1)).toContain("Get-NetTCPConnection -LocalPort 25565 -State Listen");
        expect(killed).toEqual([5120]);
    });
});

describe("listening pid parsing", () => {
    test("keeps only positive pids, once each", () => {
        expect(parseListeningPids("12\r\n\r\n0\nCOMMAND\n12\n 77 \n")).toEqual([12, 77]);
        expect(listeningPidsCommand("80", false).command).toBe("lsof");
    });
});

describe("isWindowsTarget", () => {
    test("the daemon OS string is authoritative", () => {
        expect(isWindowsTarget("C:\\srv", "windows")).toBe(true);
        expect(isWindowsTarget("C:\\srv", "Windows 11")).toBe(true);
        expect(isWindowsTarget("/home/x", "linux")).toBe(false);
        expect(isWindowsTarget("/home/x", "macos")).toBe(false);
    });

    test("a colon in a posix path proves nothing", () => {
        expect(isWindowsTarget("/home/x:my-server", "linux")).toBe(false);
        expect(isWindowsTarget("/srv", "")).toBe(false);
    });

    test("unknown OS falls back to backslash only", () => {
        expect(isWindowsTarget("C:\\srv", "")).toBe(true);
        expect(isWindowsTarget("/srv", "plan9")).toBe(false);
    });
});

describe("level-name validation", () => {
    test("accepts plain and spaced names", () => {
        expect(getWorldDirsToDelete("world")).toEqual(["world", "world_nether", "world_the_end"]);
        expect(getWorldDirsToDelete("My World")).toEqual([
            "My World",
            "My World_nether",
            "My World_the_end",
        ]);
    });

    test("refuses traversal, separators, and shell metacharacters", () => {
        for (const bad of ["../x", "a/b", "a\\b", "a$b", "a`b", "a'b", 'a"b', "a%b", "a!b", "a\nb", ""]) {
            expect(() => assertShellSafeLevelName(bad)).toThrow(/Refusing/);
        }
    });
});

describe("trashRemovePathsWith boundary", () => {
    const untouchable = {
        getServerDir: async () => {
            throw new Error("the disk must not be touched");
        },
    };

    test("an empty path list refuses", async () => {
        await expect(trashRemovePathsWith(untouchable, [])).rejects.toThrow(/no paths/);
    });

    test("traversal, absolute and separator tricks refuse before the disk", async () => {
        for (const bad of ["../x", "/etc", "a//b", "a\\b", "plugins/../..", "", ".hidden"]) {
            await expect(trashRemovePathsWith(untouchable, [bad])).rejects.toThrow(/Refusing/);
        }
        await expect(trashRemovePathsWith(untouchable, ["world"], "../out")).rejects.toThrow(
            /Refusing/,
        );
    });

    test("world dirs from an unsafe level name never get that far", () => {
        expect(() => getWorldDirsToDelete("../evil")).toThrow(/Refusing/);
    });
});

describe("player-name and console-line validation", () => {
    test("accepts real player names", () => {
        expect(assertPlayerName("Steve_42")).toBe("Steve_42");
    });

    test("refuses names that would break out of a console command", () => {
        for (const bad of ["a b", "a\nstop", "", "this-name-is-way-too-long-for-minecraft", "a;b"]) {
            expect(() => assertPlayerName(bad)).toThrow(/Refusing/);
        }
    });

    test("refuses multi-line and overlong console input", () => {
        expect(() => assertSingleLine("say hi\nstop", "chat message")).toThrow(/second console command/);
        expect(() => assertSingleLine("x".repeat(201), "kick reason")).toThrow(/cap/);
        expect(assertSingleLine("hello", "chat message")).toBe("hello");
    });
});
