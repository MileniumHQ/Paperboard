import { describe, expect, test, mock, beforeEach } from "bun:test";

// Version list, dependency resolution, and versioned install — same seams
// as the installProject suite (mocked network + fileApi + config).
describe("listProjectVersions + dependencies + installProjectVersion", () => {
    const downloadCalls: any[] = [];
    const records: Record<string, any> = {};
    let versions: any[];

    const file = (name: string, sha = "aaa111") => ({
        url: `https://cdn/${name}`,
        filename: name,
        primary: true,
        hashes: { sha1: sha },
    });

    // lib/server is stubbed outright (not just paperapi): the record write
    // path funnels through serverBridge.call, and the shared bridge instance
    // outlives any single file's paperapi mock in full-suite runs. Stubbing
    // the whole seam keeps every dependency of lib/plugins in this file.
    let stubSoftware = "paper";
    let stubVersion = "";
    mock.module("../src/lib/server", () => ({
        serverSoftware: () => stubSoftware,
        setServerSoftware: (v: string) => {
            stubSoftware = v;
        },
        serverVersion: () => stubVersion,
        setServerVersion: (v: string) => {
            stubVersion = v;
        },
        updatePanelConfig: async (patch: Record<string, unknown>) => {
            // INSTALL_RECORDS_KEY ("pluginInstalls"); hardcoded to avoid
            // importing the module under test inside the mock
            const recs = (patch as any)?.pluginInstalls;
            if (recs) Object.assign(records, recs);
        },
        serverBridge: {
            call: async () => ({}),
            refreshState: async () => ({}),
            onStateChange: () => {},
        },
    }));

    mock.module("@paperboard-dev/paperapi", () => ({
        fileApi: {
            download: async (opts: any) => {
                downloadCalls.push(opts);
                return "/fake/plugins/x.jar";
            },
            exists: async () => false,
            delete: async () => true,
            read: async () => null,
            write: async () => "/fake/x",
        },
        files: {
            download: async (opts: any) => {
                downloadCalls.push(opts);
                return "/fake/plugins/x.jar";
            },
            exists: async () => false,
            read: async () => null,
        },
        config: {
            get: async () => ({}),
            set: async () => true,
        },
        processApi: {},
        system: { getInfo: async () => ({ os: "linux" }) },
        createPanelBridge: () => ({
            onStateChange: () => {},
            refreshState: async () => ({}),
            actions: {
                loadServerConfig: async () => ({}),
                updatePanelConfig: async () => ({}),
            },
            call: async () => ({}),
        }),
    }));

    const stubFetch = (routes: Record<string, (url: string) => unknown>) => {
        (globalThis as any).fetch = async (url: string) => {
            for (const [prefix, body] of Object.entries(routes)) {
                if (url.includes(prefix)) {
                    return {
                        ok: true,
                        status: 200,
                        text: async () => JSON.stringify(body(url)),
                    };
                }
            }
            throw new Error(`unexpected fetch: ${url}`);
        };
    };

    beforeEach(() => {
        downloadCalls.length = 0;
        for (const k of Object.keys(records)) delete records[k];
    });

    const versionList = () => versions;

    test("marks the first exact build recommended", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        versions = [
            {
                id: "v-new",
                version_number: "3.0",
                game_versions: ["1.21"],
                loaders: ["paper"],
                files: [file("new.jar")],
                dependencies: [],
            },
            {
                id: "v-old",
                version_number: "2.0",
                game_versions: ["1.20.1"],
                loaders: ["paper"],
                files: [file("old.jar")],
                dependencies: [],
            },
        ];
        stubFetch({
            "/project/proj1/version": versionList,
            "/project/proj1": () => ({
                id: "proj1",
                slug: "proj1",
                title: "Proj",
            }),
        });
        const { listProjectVersions } = await import("../src/lib/plugins");
        const options = await listProjectVersions("proj1");
        expect(options).toHaveLength(2);
        expect(options[0].recommended).toBe(true);
        expect(options[0].matchesServer).toBe(true);
        expect(options[1].matchesServer).toBe(false);
    });

    test("classifies required, optional and incompatible deps with names", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        stubFetch({
            "/project/proj1": () => ({ id: "proj1", slug: "proj1", title: "Proj" }),
            "/version/dep-v1": () => ({
                id: "dep-v1",
                project_id: "dep1",
                version_number: "1.0",
                game_versions: ["1.21"],
                files: [file("dep1.jar")],
            }),
            "/project/dep1": () => ({ id: "dep1", slug: "dep1", title: "Dep One" }),
            "/project/dep2": () => ({ id: "dep2", slug: "dep2", title: "Dep Two" }),
            "/project/dep3": () => ({ id: "dep3", slug: "dep3", title: "Dep Three" }),
        });
        const { resolveVersionDependencies } = await import("../src/lib/plugins");
        const deps = await resolveVersionDependencies([
            { version_id: "dep-v1", project_id: "dep1", dependency_type: "required" },
            { project_id: "dep2", dependency_type: "optional" },
            { project_id: "dep3", dependency_type: "incompatible" },
        ]);
        const byKind = Object.fromEntries(deps.map((d) => [d.kind, d]));
        expect(byKind.required.name).toBe("Dep One");
        expect(byKind.required.file?.filename).toBe("dep1.jar");
        expect(byKind.optional.name).toBe("Dep Two");
        expect(byKind.incompatible.file).toBeUndefined();
    });

    test("installs the chosen version plus required deps, records both", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        stubFetch({
            "/version/main-v2": () => ({
                id: "main-v2",
                version_number: "2.0",
                game_versions: ["1.20.1"],
                files: [file("main.jar")],
                dependencies: [
                    { version_id: "dep-v1", project_id: "dep1", dependency_type: "required" },
                ],
            }),
            "/version/dep-v1": () => ({
                id: "dep-v1",
                project_id: "dep1",
                version_number: "1.0",
                game_versions: ["1.21"],
                files: [file("dep1.jar")],
            }),
            "/project/dep1": () => ({ id: "dep1", slug: "dep1", title: "Dep One" }),
        });
        const { installProjectVersion } = await import("../src/lib/plugins");
        const installed = await installProjectVersion({
            projectId: "proj1",
            slug: "proj1",
            versionId: "main-v2",
        });
        const kinds = Object.fromEntries(installed.map((i) => [i.kind, i.filename]));
        expect(kinds.main).toBe("main.jar");
        expect(kinds.required).toBe("dep1.jar");
        expect(downloadCalls).toHaveLength(2);
        expect(records["main.jar"].projectId).toBe("proj1");
        expect(records["main.jar"].version).toBe("2.0");
        expect(records["dep1.jar"].projectId).toBe("dep1");
        expect(records["dep1.jar"].version).toBe("1.0");
    });

    test("a missing required dep fails before anything installs", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        stubFetch({
            "/version/main-v2": () => ({
                id: "main-v2",
                version_number: "2.0",
                game_versions: ["1.20.1"],
                files: [file("main.jar")],
                dependencies: [
                    { project_id: "ghost", dependency_type: "required" },
                ],
            }),
            "/project/ghost": () => ({ id: "ghost", slug: "ghost", title: "Ghost" }),
        });
        const { installProjectVersion } = await import("../src/lib/plugins");
        const err = await installProjectVersion({
            projectId: "proj1",
            slug: "proj1",
            versionId: "main-v2",
        }).then(
            () => null,
            (e) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(String((err as Error).message)).toMatch(/Ghost/);
        expect(downloadCalls).toHaveLength(0);
    });

    test("checked optional deps install, unchecked do not", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        stubFetch({
            "/version/main-v2": () => ({
                id: "main-v2",
                version_number: "2.0",
                game_versions: ["1.21"],
                files: [file("main.jar")],
                dependencies: [
                    { version_id: "opt-v1", project_id: "opt1", dependency_type: "optional" },
                ],
            }),
            "/version/opt-v1": () => ({
                id: "opt-v1",
                project_id: "opt1",
                version_number: "1.0",
                game_versions: ["1.21"],
                files: [file("opt1.jar")],
            }),
            "/project/opt1": () => ({ id: "opt1", slug: "opt1", title: "Opt One" }),
        });
        const { installProjectVersion } = await import("../src/lib/plugins");
        const without = await installProjectVersion({
            projectId: "proj1",
            slug: "proj1",
            versionId: "main-v2",
        });
        expect(without.map((i) => i.filename)).toEqual(["main.jar"]);
        downloadCalls.length = 0;
        const withOpt = await installProjectVersion({
            projectId: "proj1",
            slug: "proj1",
            versionId: "main-v2",
            includeOptionalKeys: ["opt-v1"],
        });
        expect(withOpt.map((i) => i.filename).sort()).toEqual(["main.jar", "opt1.jar"]);
    });
});
