// The installer child's lifecycle is observed through the daemon's exit
// event: its exit code is the result, a timeout is signalled and then
// waited for, and an installer that never exits is reported as such so
// nobody deletes the folder it is writing into.
import { describe, expect, test } from "bun:test";
import {
    INSTALLER_PROC_ID,
    InstallerStillRunningError,
    runInstallerProcess,
    stopLeftoverInstaller,
    type InstallerProcessApi,
} from "../src/service/installerProcess";

interface FakeChild {
    api: InstallerProcessApi;
    signals: string[];
    started: { id: string; command: string; args?: string[] }[];
    emit(data: string): void;
    exit(code?: number): void;
    running: boolean;
    listeners: () => number;
}

function fakeChild(opts: { exitOn?: string[] } = {}): FakeChild {
    const data = new Set<(d: string) => void>();
    const exits = new Set<(c?: number) => void>();
    const child: FakeChild = {
        signals: [],
        started: [],
        running: false,
        emit: (d) => data.forEach((cb) => cb(d)),
        exit: (code) => {
            child.running = false;
            exits.forEach((cb) => cb(code));
        },
        listeners: () => data.size + exits.size,
        api: {
            start: async (o) => {
                child.started.push(o);
                child.running = true;
                return { success: true };
            },
            onData: (_id, cb) => {
                data.add(cb);
                return () => data.delete(cb);
            },
            onExit: (_id, cb) => {
                exits.add(cb);
                return () => exits.delete(cb);
            },
            kill: async (_id, signal = "SIGTERM") => {
                child.signals.push(signal);
                if (opts.exitOn?.includes(signal)) setTimeout(() => child.exit(143), 5);
            },
            exists: async () => child.running,
        },
    };
    return child;
}

const RUN = { javaBin: "/java/bin/java", args: ["-jar", "/s/installer.jar", "--installServer", "/s/server"], cwd: "/s" };

describe("runInstallerProcess", () => {
    test("runs java with the argv under the panel's installer id and reports the exit code and output tail", async () => {
        const child = fakeChild();
        const done = runInstallerProcess(RUN, child.api);
        await Bun.sleep(1);
        child.emit("Downloading library from https://maven/x.jar\nProcessor: binarypatcher\r\nThe server installed");
        child.emit(" successfully\n");
        child.exit(0);
        const result = await done;
        expect(child.started[0]).toMatchObject({ id: INSTALLER_PROC_ID, command: "/java/bin/java", args: RUN.args });
        expect(result.exitCode).toBe(0);
        expect(result.tail.at(-1)).toBe("The server installed successfully");
        expect(child.listeners()).toBe(0);
    });

    test("an exit without a code is not success", async () => {
        const child = fakeChild();
        const done = runInstallerProcess(RUN, child.api);
        await Bun.sleep(1);
        child.exit(undefined);
        expect((await done).exitCode).toBe(-1);
    });

    test("a timed-out installer is stopped and its exit observed before the failure is reported", async () => {
        const child = fakeChild({ exitOn: ["SIGTERM"] });
        await expect(runInstallerProcess({ ...RUN, timeoutMs: 20, exitGraceMs: 200 }, child.api)).rejects.toThrow(
            "did not finish",
        );
        expect(child.signals).toEqual(["SIGTERM"]);
        expect(child.running).toBe(false);
    });

    test("an installer that ignores every signal is reported still running", async () => {
        const child = fakeChild({ exitOn: [] });
        await expect(
            runInstallerProcess({ ...RUN, timeoutMs: 10, exitGraceMs: 20 }, child.api),
        ).rejects.toBeInstanceOf(InstallerStillRunningError);
        expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(child.listeners()).toBe(0);
    });

    test("a second installer is refused while one runs", async () => {
        const child = fakeChild();
        child.running = true;
        await expect(runInstallerProcess(RUN, child.api)).rejects.toThrow("still running");
        expect(child.started).toEqual([]);
    });
});

test("a leftover installer is killed and confirmed gone", async () => {
    const child = fakeChild({ exitOn: ["SIGKILL"] });
    child.running = true;
    expect(await stopLeftoverInstaller(child.api, 5, 500)).toBe(true);
    expect(child.signals).toEqual(["SIGKILL"]);
    const idle = fakeChild();
    expect(await stopLeftoverInstaller(idle.api)).toBe(false);
});
