// Build with addons.vite.ts and open /test/fixtures/addons.html. The four real add-on tabs
// (Plugins, Datapacks, Modpacks, Resource Pack) over stubbed service actions, file pickers and
// Modrinth: they render from one shared browser, uploads stage then commit (and clean up when
// they fail), a modpack upload asks first, and removing goes through the confirmation.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, fileApi } from "@mileniumhq/paperapi";

const calls: { id: string; args: any }[] = [];
const picks: { kind: string; dir: string; filters?: unknown }[] = [];
let installedDatapacks = [
    { name: "vt.zip", kind: "zip", record: { projectId: "VT", slug: "vt", title: "Vanilla Tweaks", version: "1.5" } },
    { name: "Mine.zip", kind: "zip", uploaded: true },
];
let commitFails = false;
const answers: Record<string, () => unknown> = {
    "list-installed-plugins": () => ({
        plugins: [
            { filename: "Essentials.jar", record: { projectId: "ESS", slug: "essentialsx", version: "2.20", title: "EssentialsX" } },
            { filename: "Hand.jar", uploaded: true },
        ],
    }),
    "list-datapacks": () => ({ world: "world", worldExists: true, truncated: false, packs: installedDatapacks }),
    "read-modpack": () => ({ modpack: null }),
    "read-resource-pack": () => ({ url: "", sha1: "", selection: null }),
    "list-datapack-versions": () => [{ id: "v1", projectId: "NEW", versionNumber: "1.0", name: "One", gameVersions: ["1.21.4"], primary: null }],
    "install-datapack": () => ({ name: "new.zip", world: "world", version: "1.0" }),
    "remove-datapack": () => true,
    "upload-plugins": () => {
        if (commitFails) throw new Error("Bad.jar is not a plugin: it has no plugin.yml or paper-plugin.yml at its top. Nothing was added.");
        return { added: ["Alpha.jar"] };
    },
    "upload-modpack": () => ({ title: "Test Pack", versionNumber: "1.0.0", mcVersion: "1.21.4", loaderVersion: "0.1", switchedServer: false, kept: [] }),
    "discard-addon-upload": () => true,
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, id: string, args: unknown) => {
    calls.push({ id, args });
    if (id === "get-state") return { serverSoftware: "paper", serverVersion: "1.21.4", serverStatus: "offline" };
    const answer = answers[id];
    if (!answer) throw new Error(`unexpected service call ${id}`);
    return answer();
}) as typeof actionsApi.call;
fileApi.read = async () => "motd=hello\n";
fileApi.write = (async () => {}) as typeof fileApi.write;
fileApi.importFiles = (async (dir: string, _panel: string, options?: { filters?: unknown }) => {
    picks.push({ kind: "files", dir, filters: options?.filters });
    return { status: "imported", name: "Alpha.jar", bytes: 3, files: [{ name: "Alpha.jar", bytes: 3 }] };
}) as typeof fileApi.importFiles;
fileApi.importFolder = (async (dir: string) => {
    picks.push({ kind: "folder", dir });
    return { status: "canceled" };
}) as typeof fileApi.importFolder;
fileApi.importFile = (async (path: string) => {
    picks.push({ kind: "file", dir: path });
    return { status: "imported", name: "Test.mrpack", bytes: 3 };
}) as typeof fileApi.importFile;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.modrinth.com") return realFetch(input, init);
    if (url.pathname.endsWith("/search")) {
        return Response.json({ hits: [{ project_id: "NEW", slug: "new-pack", title: "Brand New", description: "A result", downloads: 1500 }] });
    }
    // a mod loader checks each hit has a build for this loader and Minecraft version
    if (url.pathname.endsWith("/version")) {
        return Response.json([
            {
                environment: "server_only",
                loaders: ["fabric"],
                game_versions: ["1.21.4"],
                files: [{ filename: "brand-new.jar", url: "https://cdn.modrinth.com/brand-new.jar" }],
            },
        ]);
    }
    throw new Error(`unexpected Modrinth request ${url.pathname}`);
}) as typeof fetch;

const { setServerVersion, setServerSoftware } = await import("../../src/lib/server");
setServerSoftware("fabric");
setServerVersion("1.21.4");
const { default: Plugins } = await import("../../src/components/Plugins");
const { default: Datapacks } = await import("../../src/components/Datapacks");
const { default: Modpacks } = await import("../../src/components/Modpacks");
const { default: ResourcePack } = await import("../../src/components/ResourcePack");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (id: string) => document.getElementById(id)!.innerText;
const wait = async (predicate: () => boolean, what: string) => {
    for (let i = 0; i < 150; i++) {
        if (predicate()) return;
        await sleep(20);
    }
    throw new Error(`Timed out waiting for ${what}`);
};
const assert = (value: unknown, label: string) => {
    if (!value) throw new Error(label);
};
const button = (scope: string, label: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>(`#${scope} button, body > div button, [role="dialog"] button`)].find(
        (b) => b.innerText.trim().split("\n").pop() === label, // the icon glyph is the first line
    );
const click = async (scope: string, label: string) => {
    await wait(() => !!button(scope, label) && !(button(scope, label) as HTMLButtonElement).disabled, `button "${label}"`);
    button(scope, label)!.click();
};
const called = (id: string) => calls.filter((c) => c.id === id);

const disposers: (() => void)[] = [];
const mount = (id: string, Tab: () => any) =>
    disposers.push(render(() => <PaperProvider><Tab /></PaperProvider>, document.getElementById(id)!));

try {
    mount("plugins", () => <Plugins />);
    mount("datapacks", () => <Datapacks active />);
    mount("modpacks", () => <Modpacks active />);
    mount("resourcepack", () => <ResourcePack active />);

    // every tab comes from the one browser: header, installed list, search, results
    await wait(() => text("plugins").includes("EssentialsX") && text("plugins").includes("Brand New"), "plugins");
    assert(text("plugins").includes("Mods"), "a mod loader calls the tab Mods");
    assert(text("plugins").includes("Uploaded"), "an uploaded jar is marked uploaded");
    assert(text("plugins").includes("Installed Mods"), "installed list title");
    await wait(() => text("datapacks").includes("Vanilla Tweaks") && text("datapacks").includes("Brand New"), "datapacks");
    assert(text("datapacks").includes("World: world"), "the datapack world note");
    assert(text("datapacks").includes("Uploaded by you"), "an uploaded datapack is marked");
    await wait(() => text("modpacks").includes("Brand New"), "modpacks");
    await wait(() => text("resourcepack").includes("Brand New") && text("resourcepack").includes("Direct URL"), "resource pack");
    assert(text("resourcepack").includes("Require Resource Pack"), "the pack settings render beside the shared browser");
    assert(!text("resourcepack").includes("Upload"), "a resource pack is a URL, so it has no upload");
    assert(text("plugins").includes("Upload mods") && text("datapacks").includes("Upload zips") && text("datapacks").includes("Upload folder"), "upload actions");
    assert(text("modpacks").includes("Upload .mrpack"), "modpack upload action");

    // a failed upload says why and cleans up the staged files
    commitFails = true;
    await click("plugins", "Upload mods");
    await wait(() => text("plugins").includes("Bad.jar is not a plugin"), "the refusal");
    assert(picks[0]!.kind === "files" && /^\.paperboard-transfer\/addon-[0-9a-f-]{36}$/.test(picks[0]!.dir), `staged below the transfer folder: ${picks[0]?.dir}`);
    assert(JSON.stringify(picks[0]!.filters).includes("jar"), "the picker offers jars");
    const stage = called("upload-plugins")[0]!.args.stage;
    assert(picks[0]!.dir.endsWith(stage), "the commit names the stage the pick staged");
    await wait(() => called("discard-addon-upload").length === 1, "the discard");
    assert(called("discard-addon-upload")[0]!.args.stage === stage, "the failed stage is discarded");

    // a good one refreshes the list and says what was added
    commitFails = false;
    await click("plugins", "Upload mods");
    await wait(() => text("plugins").includes("Alpha.jar will load the next time the server starts"), "the success notice");
    assert(!text("plugins").includes("Bad.jar is not a plugin"), "the earlier refusal is gone");

    // a cancelled picker changes nothing
    const before = calls.length;
    await click("datapacks", "Upload folder");
    await sleep(100);
    assert(calls.slice(before).every((c) => c.id !== "upload-datapacks"), "a cancelled pick commits nothing");

    // a modpack upload replaces the mods, so it asks first
    await click("modpacks", "Upload .mrpack");
    await wait(() => document.body.innerText.includes("Install this modpack"), "the modpack confirmation");
    assert(called("upload-modpack").length === 0, "nothing installs before the confirmation");
    assert(picks.at(-1)!.dir.endsWith("/pack.mrpack"), "the pack is staged as pack.mrpack");
    await click("modpacks", "Install");
    await wait(() => called("upload-modpack").length === 1, "the modpack commit");
    await wait(() => text("modpacks").includes("Test Pack v1.0.0 installed"), "the install outcome");

    // installing a search result goes through the version dialog
    const card = [...document.querySelectorAll<HTMLElement>("#datapacks *")].find((e) => e.children.length === 0 && e.innerText === "Brand New")!;
    card.click();
    await wait(() => document.body.innerText.includes("Install Brand New"), "the install dialog");
    await wait(() => document.body.innerText.includes("Installs into world/datapacks/"), "the datapack note in the dialog");
    await click("datapacks", "Install");
    await wait(() => called("install-datapack").length === 1, "the install");
    assert(called("install-datapack")[0]!.args.versionId === "v1", "the chosen version is installed");

    // removing asks first
    const pack = [...document.querySelectorAll<HTMLElement>("#datapacks *")].find((e) => e.children.length === 0 && e.innerText === "Mine")!;
    pack.click();
    await wait(() => document.body.innerText.includes("Move Mine out of world/datapacks/"), "the remove confirmation");
    assert(called("remove-datapack").length === 0, "nothing is removed before the confirmation");
    installedDatapacks = installedDatapacks.slice(0, 1);
    await click("datapacks", "Remove");
    await wait(() => called("remove-datapack").length === 1 && !text("datapacks").includes("Uploaded by you"), "the removal");
    assert(called("remove-datapack")[0]!.args.name === "Mine.zip", "the chosen pack is removed");

    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}\n${document.body.innerText.slice(0, 1500)}`;
} finally {
    for (const dispose of disposers) dispose();
}
