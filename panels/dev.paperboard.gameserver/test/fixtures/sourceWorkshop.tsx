// Team Fortress 2's Maps tab with Steam Workshop maps as a person meets them (real browser, real PaperUI):
// the Add maps dialog searches the Workshop for maps, a chosen one is added to the server and to the
// rotation, and a search that fails, or an item the service refuses, says why. The service is stood in for
// at the Actions boundary only. Opened as sourceWorkshop.html?server=s1 by test/sourceWorkshop.test.ts.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";
import { initialServerState } from "../../src/service/initialState";
import { serverStateKey } from "../../src/servers";

const checks: Record<string, unknown> = {};
const uncaught: string[] = [];
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
window.addEventListener("error", (e) => uncaught.push(String(e.message)));

const meta = { attribution: "Powered by Steam", source: "https://store.steampowered.com/", legal: "©2026 Valve Corporation. Steam and the Steam logo are trademarks.", disclaimer: "Paperboard is not endorsed by or affiliated with Valve or Steam." };
const discovery = { id: "454116880", title: "Discovery", previewImageUrl: "https://images.steamusercontent.com/ugc/discovery/", tags: ["Arena"], subscribers: 4810, updated: 1677728898 };
let library: any[] = [];
let maps = ["ctf_2fort", "cp_dustbowl"];
let search: (input: any) => unknown = () => ({ items: [{ ...discovery, added: false }, { id: "512422248", title: "MVM Area 52", previewImageUrl: null, tags: ["Mann vs. Machine"], subscribers: 10945, updated: 1, added: false }], hidden: 3, meta });
let add: (input: any) => unknown = () => library.push(discovery);
const calls: { action: string; input: any }[] = [];
const view = () => ({ maps, custom: true, file: "cfg/paperboard_mapcycle.txt", installed: ["ctf_2fort", "cp_dustbowl", ...library.map((m) => `workshop/${m.id}`)], workshop: library, overriddenBy: null });

const state = {
    servers: [{ id: "s1", name: "Fixture", game: "team-fortress-2", directory: "servers/s1", createdAt: 1, configured: true, icon: null, state: { serverStatus: "offline", serverSoftware: "steam", serverVersion: "", serverPort: "27015", recoveryBlock: null, maxPlayers: 24, playerCount: 0 } }],
    serversError: null,
    [serverStateKey("s1")]: { ...initialServerState() },
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string, input: any) => {
    if (action === "__getState") return state;
    calls.push({ action, input });
    if (action === "s1/team-fortress-2-map-cycle") return view();
    if (action === "s1/team-fortress-2-map-pictures") return { source: { name: "Test Wiki", url: "https://wiki.example/maps" }, pictures: {}, titles: { ctf_2fort: "2Fort" } };
    if (action === "s1/team-fortress-2-workshop-find") return search(input);
    if (action === "s1/team-fortress-2-workshop-add") { add(input); return library; }
    if (action === "s1/team-fortress-2-map-cycle-set") { maps = input.maps; return view(); }
    return {};
}) as typeof actionsApi.call;

const wait = async (what: string, predicate: () => boolean) => {
    for (let i = 0; i < 250; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}: ${document.body.innerText.slice(0, 700)}`);
};
const text = () => document.body.innerText;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const card = (title: string) => [...document.querySelectorAll<HTMLElement>('[role="button"]')].find((c) => c.textContent?.includes(title));

let error = "";
try {
    const { default: SourceMaps } = await import("../../src/games/source/Maps");
    const { TF2 } = await import("../../src/games/tf2");
    const root = document.getElementById("app")!;
    render(() => <PaperProvider><SourceMaps spec={TF2} active={true} /></PaperProvider>, root);
    await wait("the rotation", () => Boolean(button("Add maps")));
    // a map is called by the wiki's name, its file name and mode beside it; one the wiki doesn't name by its file name
    const rowOf = (title: string) => [...document.querySelectorAll<HTMLElement>("label")].find((l) => l.textContent?.includes(title));
    await wait("the wiki's names", () => Boolean(rowOf("2Fort")));
    checks.rowRealName = rowOf("2Fort")!.textContent!.includes("ctf_2fort · Capture the Flag");
    checks.rowFileNameAlone = rowOf("cp_dustbowl")!.textContent!.replace(/map/, "").trim().startsWith("cp_dustbowl") && !rowOf("cp_dustbowl")!.textContent!.includes("cp_dustbowl · cp_dustbowl");

    // the dialog offers the Workshop beside what is on the server, and asks what is popular
    button("Add maps")!.click();
    await wait("the dialog", () => Boolean(button("Steam Workshop")));
    button("Steam Workshop")!.click();
    await wait("the popular maps", () => Boolean(card("Discovery")));
    checks.askedPopular = calls.find((c) => c.action.endsWith("workshop-find"))?.input;
    checks.titles = Boolean(card("MVM Area 52"));
    checks.pictureOfItsOwn = card("Discovery")!.querySelector("img")?.getAttribute("src");
    checks.noPicture = card("MVM Area 52")!.textContent?.includes("No picture");
    checks.subscribers = text().includes("4.8k subscribers");
    checks.hiddenSaid = text().includes("3 results are not maps and left out");
    checks.attribution = text().includes("Powered by Steam") && text().includes("not endorsed by or affiliated with Valve") && text().includes("Valve Corporation");

    // choosing one adds it to the server, then to the end of the rotation
    card("Discovery")!.click();
    await wait("the rotation to take it", () => maps.includes("workshop/454116880"));
    checks.added = calls.filter((c) => c.action.endsWith("workshop-add")).map((c) => c.input);
    checks.rotation = maps;
    await wait("the confirmation", () => text().includes("Discovery joined the end of the rotation"));
    checks.joinedSaid = true;
    checks.cardSaysInRotation = card("Discovery")!.textContent?.includes("In the rotation");
    checks.addedBeforeRotation = calls.findIndex((c) => c.action.endsWith("workshop-add")) < calls.findIndex((c) => c.action.endsWith("map-cycle-set"));

    // the service refuses an item: the reason is shown, and the rotation stays as it was
    add = () => { throw new Error("MVM Area 52 is not a map: Steam Workshop lists no game mode for it"); };
    card("MVM Area 52")!.click();
    await wait("the refusal", () => text().includes("MVM Area 52 was not added"));
    checks.refusalReason = text().includes("lists no game mode for it");
    checks.rotationKept = maps.length === 3;

    // a search the Workshop can't answer: the failure, its reason, and the pasted-link way round it
    search = () => { throw new Error("Steam Workshop search failed: Steam returned invalid Workshop data."); };
    const input = [...document.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder.startsWith("Search the Steam Workshop"))!;
    input.value = "dustbowl";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    button("Search")!.click();
    await wait("the search failure", () => text().includes("The Steam Workshop could not be searched"));
    checks.searchReason = text().includes("Steam returned invalid Workshop data");
    checks.pasteHint = text().includes("pasted above is looked up on its own");
    checks.queryKept = input.value === "dustbowl";
    checks.askedFor = calls.filter((c) => c.action.endsWith("workshop-find")).at(-1)?.input;
    checks.rotationCardsGone = !card("Discovery");

    // the rotation row carries the Workshop map's own title and picture, and the server's own maps still add
    button("Done")!.click();
    await wait("the rotation list", () => text().includes("Steam Workshop") && text().includes("Discovery"));
    checks.rowSaysWorkshop = text().includes("Steam Workshop");
    checks.rowPicture = [...document.querySelectorAll("img")].some((i) => i.getAttribute("src") === discovery.previewImageUrl);

} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
