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
    // what the service answers per action id, for the update check's listing
    const bridgeAnswers: Record<string, unknown> = {};
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
            call: async (id: string) => bridgeAnswers[id] ?? {},
            refreshState: async () => ({}),
            onStateChange: () => {},
        },
    }));

    mock.module("../src/lib/api", () => ({
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
            get: async () => ({ pluginInstalls: { ...records } }),
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
                        json: async () => body(url),
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
            title: "Project One",
            versionId: "main-v2",
        });
        const kinds = Object.fromEntries(installed.map((i) => [i.kind, i.filename]));
        expect(kinds.main).toBe("main.jar");
        expect(kinds.required).toBe("dep1.jar");
        expect(downloadCalls).toHaveLength(2);
        expect(records["main.jar"].projectId).toBe("proj1");
        expect(records["main.jar"].version).toBe("2.0");
        // titles persist with the record so a reload shows names, not slugs
        expect(records["main.jar"].title).toBe("Project One");
        expect(records["dep1.jar"].projectId).toBe("dep1");
        expect(records["dep1.jar"].version).toBe("1.0");
        expect(records["dep1.jar"].title).toBe("Dep One");
    });

    test("a required dep that is already installed is not installed twice", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("fabric");
        server.setServerVersion("1.21");
        records["fabric-api-0.90.jar"] = { projectId: "dep1", slug: "fabric-api", version: "0.90" };
        stubFetch({
            "/version/main-v2": () => ({
                id: "main-v2",
                version_number: "2.0",
                game_versions: ["1.21"],
                loaders: ["fabric"],
                files: [file("main.jar")],
                dependencies: [{ project_id: "dep1", dependency_type: "required" }],
            }),
            "/project/dep1/version": () => [
                { id: "dep-v2", project_id: "dep1", version_number: "0.95", game_versions: ["1.21"], loaders: ["fabric"], files: [file("fabric-api-0.95.jar")] },
            ],
            "/project/dep1": () => ({ id: "dep1", slug: "fabric-api", title: "Fabric API" }),
        });
        const { installProjectVersion } = await import("../src/lib/plugins");
        const installed = await installProjectVersion({ projectId: "proj1", slug: "proj1", versionId: "main-v2" });
        expect(installed.map((i) => i.filename)).toEqual(["main.jar"]);
        expect(downloadCalls.map((c) => c.targetPath)).toEqual(["mods/main.jar"]);
    });

    test("Update plugins finds and installs a newer GeyserMC build (Floodgate for Paper)", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("26.3");
        const source = { kind: "geysermc", project: "floodgate", platform: "spigot" };
        records["floodgate-spigot.jar"] = { projectId: "floodgate", slug: "floodgate", version: "2.2.5-b140", title: "Floodgate", source };
        bridgeAnswers["list-installed-plugins"] = { plugins: [{ filename: "floodgate-spigot.jar", record: records["floodgate-spigot.jar"] }] };
        stubFetch({
            "download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest": () => ({
                version: "2.2.5",
                build: 141,
                downloads: { spigot: { name: "floodgate-spigot.jar", sha256: "f".repeat(64) } },
            }),
        });
        const { checkPluginUpdates, updatePlugin } = await import("../src/lib/plugins");
        const [check] = await checkPluginUpdates();
        expect(check!.status).toBe("update-available");
        await updatePlugin(check!);
        expect(downloadCalls).toEqual([
            {
                url: "https://download.geysermc.org/v2/projects/floodgate/versions/2.2.5/builds/141/downloads/spigot",
                targetPath: "plugins/floodgate-spigot.jar",
                appId: "dev.paperboard.gameserver",
                sha256: "f".repeat(64),
            },
        ]);
        expect(records["floodgate-spigot.jar"]).toEqual({ ...records["floodgate-spigot.jar"], version: "2.2.5-b141", source });
        delete bridgeAnswers["list-installed-plugins"];
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
