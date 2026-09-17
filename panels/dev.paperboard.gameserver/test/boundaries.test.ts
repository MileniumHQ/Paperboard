// Service-boundary proofs (bun test): ports, level names, player names,
// and trash-remove commands are validated before they reach a shell.
import { describe, test, expect } from "bun:test";
import {
    assertPort,
    buildKillPortCommand,
    killConflictingProcessWith,
} from "../src/core/diagnostics";
import {
    getWorldDirsToDelete,
    assertShellSafeLevelName,
    deleteWorldDirs,
} from "../src/core/worlds";
import {
    buildTrashRemoveCommand,
    trashRemovePathsWith,
} from "../src/core/trash";
import { isWindowsTarget } from "../src/lib/platform";
import { assertPlayerName, assertSingleLine } from "../src/core/players";

function mockDeps() {
    const calls: { op: string; arg?: unknown }[] = [];
    return {
        calls,
        deps: {
            getServerDir: () => Promise.resolve("/srv/mc"),
            getTargetOs: () => Promise.resolve("linux"),
            createPty: (id: string, opts: unknown) => {
                calls.push({ op: "create", arg: { id, opts } });
                return true;
            },
            writePty: (id: string, data: string) => {
                calls.push({ op: "write", arg: { id, data } });
                // model the real pty: the shell ECHOES the typed command
                // line before executing it, so the terminal shows the
                // typed (quote-scarred) marker form, never the bare marker
                for (const dataCb of pendingDataCbs) dataCb(`${data}\r\n`);
            },
            onPtyData: (_id: string, cb: (chunk: string) => void) => {
                calls.push({ op: "subscribe-data", arg: _id });
                pendingDataCbs.push(cb);
                return () => {};
            },
            onPtyExit: (id: string, cb: (code?: number) => void) => {
                calls.push({ op: "subscribe-exit", arg: id });
                // the shell then prints the marker chain's actual OUTPUT
                // (unscarred) ahead of the exit — how a real success reads
                queueMicrotask(() => {
                    for (const dataCb of pendingDataCbs)
                        dataCb("\r\nTRASH_REMOVE_OK\r\nTRASH_REMOVE_DONE\r\n");
                    queueMicrotask(() => cb(0));
                });
                return () => {};
            },
            scheduleDestroy: (id: string) => {
                calls.push({ op: "destroy", arg: id });
            },
        },
        // test hook for failure modeling: push extra data chunks
        feedOutput: (chunk: string) => {
            for (const dataCb of pendingDataCbs) dataCb(chunk);
        },
    };
}

const pendingDataCbs: ((chunk: string) => void)[] = [];

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
    test("a UI-supplied injection never reaches the pty", async () => {
        const { calls, deps } = mockDeps();
        await expect(killConflictingProcessWith(deps, "25565; touch /tmp/pwned")).rejects.toThrow(
            /Refusing/,
        );
        // the refusal happens before any pty exists
        expect(calls).toEqual([]);
    });

    test("a valid port builds the targeted kill command", async () => {
        const { calls, deps } = mockDeps();
        await killConflictingProcessWith(deps, "25565");
        const write = calls.find((c) => c.op === "write")?.arg as { data: string };
        expect(write.data).toContain("lsof -ti :25565");
        expect(write.data).not.toContain("killall");
    });

    test("windows target builds the powershell variant", () => {
        const cmd = buildKillPortCommand("25565", true);
        expect(cmd).toContain("LocalPort 25565");
        expect(cmd).not.toContain("lsof");
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

    test("deleteWorldDirs refuses before touching a pty", async () => {
        const { calls, deps } = mockDeps();
        await expect(deleteWorldDirs("../evil", deps)).rejects.toThrow(/Refusing/);
        expect(calls).toEqual([]);
    });
});

describe("buildTrashRemoveCommand", () => {
    test("posix moves each existing path to retained recovery", () => {
        expect(buildTrashRemoveCommand(["world", "My World_nether"], ".trash-1", false)).toBe(
            "mkdir -p '.trash-1' && ( [ ! -e 'world' ] || mv 'world' '.trash-1' ) && ( [ ! -e 'My World_nether' ] || mv 'My World_nether' '.trash-1' ) && echo TRASH_REMOVE_'OK' ; echo TRASH_REMOVE_'DONE'",
        );
    });

    test("windows moves each existing path to retained recovery", () => {
        expect(buildTrashRemoveCommand(["world", "My Plugin.jar"], ".trash-1", true)).toBe(
            'mkdir ".trash-1" && if exist "world" move "world" ".trash-1" && if exist "My Plugin.jar" move "My Plugin.jar" ".trash-1" && echo TRASH_REMOVE_O^K & echo TRASH_REMOVE_D^ONE',
        );
    });

    test("an empty path list refuses instead of emitting a bare rm", () => {
        expect(() => buildTrashRemoveCommand([], ".trash-1", false)).toThrow();
    });

    test("a missing dimension dir is skipped, not fatal", () => {
        const cmd = buildTrashRemoveCommand(
            ["world", "world_nether", "world_the_end"],
            ".trash-1",
            false,
        );
        // each move is existence-guarded, so a never-entered nether/end
        // cannot abort the chain before the OK marker
        expect(cmd).toContain("[ ! -e 'world_nether' ] || mv 'world_nether' '.trash-1'");
        expect(cmd).toContain("[ ! -e 'world_the_end' ] || mv 'world_the_end' '.trash-1'");
        expect(cmd.indexOf("TRASH_REMOVE_'OK'")).toBeGreaterThan(
            cmd.indexOf("rm -rf '.trash-1'"),
        );
    });

    test("trashRemovePathsWith runs in the server dir and destroys the pty", async () => {
        const { calls, deps } = mockDeps();
        await trashRemovePathsWith(deps, ["world"], "test-pty", ".trash-9");
        expect(calls[0]).toEqual({
            op: "create",
            arg: { id: "test-pty", opts: { cwd: "/srv/mc", cols: 80, rows: 24 } },
        });
        // completion is verified: data + exit subscribed BEFORE the write
        expect(calls[1]).toEqual({ op: "subscribe-data", arg: "test-pty" });
        expect(calls[2]).toEqual({ op: "subscribe-exit", arg: "test-pty" });
        const write = calls[3].arg as { data: string };
        expect(write.data).toContain("mv 'world' '.trash-9'");
        expect(write.data).toContain("echo TRASH_REMOVE_'OK'");
        expect(calls[4]).toEqual({ op: "destroy", arg: "test-pty" });
    });

    test("the pty ECHO of the typed command cannot fake a success marker", async () => {
        // a partial failure: the shell echoes the typed command (which
        // contains the QUOTED marker fragments), the chain breaks before
        // any real marker output, and the shell exits (exit is written
        // after).
        const { deps, calls } = mockDeps();
        let resolveExit: (c?: number) => void = () => {};
        const exitSub = {
            onPtyExit: (id: string, cb: (code?: number) => void) => {
                resolveExit = cb;
                return () => {};
            },
        };
        const failingDeps = {
            ...deps,
            ...exitSub,
        };
        // subscribe exits through calls[] wiring: run trash in a way that
        // completions never receive the OK output
        const pending = trashRemovePathsWith(failingDeps as any, ["world"], "p-echo", ".trash-e");
        // after write, consumers saw ONLY the echoed command line
        // (pendingDataCbs got the typed scarred form). Now the shell exits.
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        resolveExit(0);
        await expect(pending).rejects.toThrow(/without the "TRASH_REMOVE_OK" marker/);
        expect(calls[calls.length - 1]).toEqual({ op: "destroy", arg: "p-echo" });
    });

    test("the unscarred output marker satisfies the verified success path", async () => {
        const { deps } = mockDeps();
        await trashRemovePathsWith(deps, ["world"], "test-pty-ok", ".trash-10");
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
