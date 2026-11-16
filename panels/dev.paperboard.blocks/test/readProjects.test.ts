// The projects are read as the service starts. When that fails, nothing runs
// and every call is refused, until the page asks the service to read them
// again and the read goes through: then the list, the calls and the
// Projects blocks are all there, as if it had worked the first time.
import { expect, test } from "bun:test";
import { memoryBlocks } from "@mileniumhq/paperapi";
import { createRuntime, type RuntimeDeps } from "../src/runtime";
import { PANEL_ID, blocksContract, type PanelState } from "../src/panel";
import type { ProjectStorage } from "../src/lib/projects";

const nothing = async () => {
    throw new Error("the test runs no blocks");
};

test("projects that couldn't be read are read again when the page asks, and everything works once they are", async () => {
    const files = new Map<string, unknown>();
    let disk: string | null = "the disk is gone";
    const storage: ProjectStorage = {
        get: async (path) => {
            if (disk) throw new Error(disk);
            return structuredClone(files.get(path ?? "") ?? null);
        },
        set: async (value, path) => {
            if (disk) throw new Error(disk);
            files.set(path ?? "", structuredClone(value));
        },
    };
    const blocks: RuntimeDeps["blocks"] = {
        onEvent: () => () => {},
        onChange: () => () => {},
        run: nothing as unknown as RuntimeDeps["blocks"]["run"],
        read: nothing as unknown as RuntimeDeps["blocks"]["read"],
        property: nothing as unknown as RuntimeDeps["blocks"]["property"],
    };
    const registry = memoryBlocks(PANEL_ID, { fired: () => {}, changed: () => {} });
    const runtime = createRuntime({ storage, blocks, handle: registry.panel });
    let state: PanelState = structuredClone(blocksContract.state.initial);
    await runtime.init((patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    });
    expect(state.projectsError).toBe("the disk is gone");
    await expect(runtime.calls.createProject({ name: "Lobby" })).rejects.toThrow("The projects couldn't be read: the disk is gone");

    // still unreadable: the page hears why, and nothing changes
    disk = "the disk is still gone";
    await expect(runtime.calls.readProjects()).rejects.toThrow("the disk is still gone");
    expect(state.projectsError).toBe("the disk is still gone");

    disk = null;
    await runtime.calls.readProjects();
    expect(state.projectsError).toBeNull();
    const made = await runtime.calls.createProject({ name: "Lobby" });
    expect(state.projects.map((p) => p.name)).toEqual(["Lobby"]);
    expect(made.name).toBe("Lobby");
    // the Projects blocks are offered, as they are when the first read works
    expect(registry.list().length).toBeGreaterThan(0);
    // asked again once they're read, the service has nothing to do
    await runtime.calls.readProjects();
    expect(state.projectsError).toBeNull();
});
