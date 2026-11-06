// Team Fortress 2's setup as a person meets it (real browser, real PaperUI): Minecraft's wizard, one
// question a step. After the install, the game mode as picture cards and Next, then the starting map
// with Back to the modes; Finish Setup saves through the service and says so when the service refuses.
// The map pictures load while the game downloads. The service is stood in for at the Actions boundary
// only. Opened as sourceSetup.html?server=s1 by test/sourceSetup.test.ts.
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

// every picture the page asks the browser for, and when
const loading: string[] = [];
const BrowserImage = window.Image;
window.Image = class extends BrowserImage {
    set src(url: string) { loading.push(url); super.src = url; }
    get src() { return super.src; }
} as typeof Image;

let installed = ["ctf_2fort", "ctf_turbine", "pl_badwater", "cp_dustbowl", "zz_unlisted"];
let pictures: () => unknown = () => ({ source: { name: "Test Wiki", url: "https://wiki.example/maps" }, pictures: { ctf_2fort: "https://wiki.example/ctf_2fort.png", cp_dustbowl: "https://wiki.example/cp_dustbowl.png" }, titles: { ctf_2fort: "2Fort", cp_dustbowl: "Dustbowl (Control Point)" } });
let play: (input: any) => unknown = () => ({});
let mapsFails = "";
// a download that finished before setup opened, as the service reports it
let downloaded = false;
let installCalls = 0;
// the download ends when the test says so
let finishDownload = () => {};
const played: any[] = [];
const state = {
    servers: [{ id: "s1", name: "Fixture", game: "team-fortress-2", directory: "servers/s1", createdAt: 1, configured: false, icon: null, state: { serverStatus: "offline", serverSoftware: "steam", serverVersion: "", serverPort: "27015", recoveryBlock: null, maxPlayers: 24, playerCount: 0 } }],
    serversError: null,
    [serverStateKey("s1")]: { ...initialServerState() },
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string, input: any) => {
    if (action === "__getState") return state;
    if (action === "s1/team-fortress-2-info") return { host: { supported: true }, build: downloaded ? "26334371" : null, version: null, downloaded };
    if (action === "s1/team-fortress-2-install") { installCalls++; await new Promise<void>((resolve) => (finishDownload = resolve)); return true; }
    if (action === "s1/team-fortress-2-maps") { if (mapsFails) throw new Error(mapsFails); return installed; }
    if (action === "s1/team-fortress-2-map-pictures") return pictures();
    if (action === "s1/team-fortress-2-play") { played.push(input); return play(input); }
    return {};
}) as typeof actionsApi.call;

const wait = async (what: string, predicate: () => boolean) => {
    for (let i = 0; i < 250; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}: ${document.body.innerText.slice(0, 600)}`);
};
const text = () => document.body.innerText;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
const card = (title: string) => [...document.querySelectorAll<HTMLElement>('[role="button"]')].find((c) => c.querySelector("p, span, div")?.textContent?.trim() === title || c.textContent?.includes(title));
const heading = (title: string) => [...document.querySelectorAll<HTMLElement>("*")].find((e) => e.children.length === 0 && e.textContent?.trim() === title);
// a step's cards scroll under its title, as Minecraft's version list does
const cardPane = (title: string) => {
    for (let e: HTMLElement | null = card(title)!; e; e = e.parentElement) if (getComputedStyle(e).overflowY === "auto") return e;
    throw new Error(`${title} is in no scrolling pane`);
};
const cardImage = (title: string) => card(title)?.querySelector("img")?.getAttribute("src") ?? null;

let error = "";
try {
    const { sourceUI } = await import("../../src/games/source/ui");
    const { tf2, TF2 } = await import("../../src/games/tf2");
    const root = document.getElementById("app")!;

    const open = async (withPictures = true) => {
        played.length = 0;
        loading.length = 0;
        let completed = 0;
        const stop = render(() => <PaperProvider>{sourceUI(TF2, tf2).create({} as any).setup({ onComplete: () => { completed++; } } as any)}</PaperProvider>, root);
        // while the game downloads, its map pictures are already loading
        await wait("the download to start", () => text().includes("Downloading Team Fortress 2"));
        if (withPictures) await wait("the pictures to load during the download", () => loading.length > 0);
        const duringDownload = [...loading];
        finishDownload();
        await wait("the download to finish", () => Boolean(button("Next") && !button("Next")!.disabled));
        button("Next")!.click();
        return { completed: () => completed, stop, duringDownload };
    };

    // the modes: those the game lists with an installed map, each drawn by one of its maps, and a mixed choice
    let run = await open();
    checks.picturesDuringDownload = run.duringDownload.includes("https://wiki.example/ctf_2fort.png") && run.duringDownload.includes("https://wiki.example/cp_dustbowl.png");
    await wait("the game modes", () => Boolean(card("Capture the Flag")));
    checks.modesTitled = Boolean(heading("Game Mode"));
    checks.modes = ["Capture the Flag", "Control Point", "Payload", "Mixed", "Arena"].map((title) => Boolean(card(title)));
    checks.unlistedMapHidden = !text().includes("zz_unlisted");
    checks.modeCounts = text().includes("2 maps") && text().includes("1 map");
    checks.ctfDrawnByItsMap = cardImage("Capture the Flag");
    checks.noPictureNoIcon = cardImage("Payload");
    checks.attribution = text().includes("Map pictures from Test Wiki");
    checks.nextWaitsForAMode = button("Next")!.disabled;
    // the download is done: there is no going back to it
    checks.noBackToDownload = !button("Back");
    // Mixed is drawn by pictures of several modes' maps, not a lone symbol; each is a different map's
    const mixedTiles = [...card("Mixed")!.querySelectorAll<HTMLImageElement>('[role="img"] img')].map((i) => i.getAttribute("src"));
    checks.mixedTiled = mixedTiles.length === 2 && new Set(mixedTiles).size === 2 && mixedTiles.includes("https://wiki.example/ctf_2fort.png") && mixedTiles.includes("https://wiki.example/cp_dustbowl.png");
    checks.mixedDescribed = card("Mixed")!.querySelector('[role="img"]')?.getAttribute("aria-label") === "Mixed, shown by 2Fort, Dustbowl (Control Point)";
    const modesTitle = heading("Game Mode")!.getBoundingClientRect();
    // a short window, so the modes scroll under their title; a pick is made from far down the list
    const modesPane = cardPane("Capture the Flag");
    modesPane.style.maxHeight = "120px";
    modesPane.scrollTop = modesPane.scrollHeight;
    checks.modesScrolled = modesPane.scrollTop > 0 && heading("Game Mode")!.getBoundingClientRect().top === modesTitle.top;

    // a pick is chosen, not gone on from: Next goes on
    card("Capture the Flag")!.click();
    await wait("the pick", () => card("Capture the Flag")!.getAttribute("aria-pressed") === "true");
    checks.pickStays = Boolean(heading("Game Mode")) && !button("Next")!.disabled;
    button("Next")!.click();
    await wait("the starting maps", () => Boolean(card("ctf_turbine")));
    checks.sameInset = Math.round(heading("Starting Map")!.getBoundingClientRect().left) === Math.round(modesTitle.left) && Math.round(heading("Starting Map")!.getBoundingClientRect().top) === Math.round(modesTitle.top);
    checks.stepOpensAtTop = cardPane("ctf_turbine").scrollTop === 0;
    checks.mapsOfTheMode = !text().includes("pl_badwater") && Boolean(card("ctf_2fort"));
    checks.firstMapChosen = card("ctf_2fort")!.getAttribute("aria-pressed") === "true";
    // a map is called by the wiki's name with its file name second; one the wiki doesn't name has its file name alone
    checks.mapNamedByWiki = card("2Fort")?.textContent?.includes("2Fort") === true && card("2Fort")!.textContent!.includes("ctf_2fort");
    checks.mapNameFirst = [...card("2Fort")!.querySelectorAll("p, span, div")].map((e) => e.textContent?.trim()).filter((t) => t === "2Fort" || t === "ctf_2fort").slice(0, 2).join(",") === "2Fort,ctf_2fort";
    // (what is left once the picture's own "No picture" note is set aside)
    const lines = (c: Element) => [...c.querySelectorAll("*")].filter((e) => e.children.length === 0 || e.querySelector("wbr")).map((e) => e.textContent?.trim()).filter((t) => t && t !== "map" && t !== "No picture");
    checks.unnamedMapByFile = JSON.stringify([...new Set(lines(card("ctf_turbine")!))]) === JSON.stringify(["ctf_turbine"]);
    checks.finishOpen = !button("Finish Setup")!.disabled;
    card("ctf_turbine")!.click();
    await wait("the new choice", () => card("ctf_turbine")!.getAttribute("aria-pressed") === "true");
    checks.choiceMoves = card("ctf_2fort")!.getAttribute("aria-pressed") === "false";

    // Back is to the modes, with the mode still chosen; going on again keeps the map chosen
    button("Back")!.click();
    await wait("the modes again", () => Boolean(heading("Game Mode")));
    checks.backKeepsTheMode = card("Capture the Flag")!.getAttribute("aria-pressed") === "true" && !button("Next")!.disabled && !button("Back");
    button("Next")!.click();
    await wait("the starting maps again", () => Boolean(card("ctf_turbine")));
    checks.backKeepsTheMap = card("ctf_turbine")!.getAttribute("aria-pressed") === "true";
    checks.nothingSavedBeforeFinish = played.length === 0;

    // a service that refuses: setup says why, stays, and the same choice can be tried again
    play = () => { throw new Error("ctf_turbine is not installed"); };
    button("Finish Setup")!.click();
    await wait("the refusal", () => text().includes("Setup is not finished"));
    checks.refusalReason = text().includes("ctf_turbine is not installed");
    checks.refusedStays = run.completed() === 0 && Boolean(heading("Starting Map"));
    await wait("Finish to come back", () => !button("Finish Setup")!.disabled);
    play = () => ({});
    button("Finish Setup")!.click();
    await wait("setup to complete", () => run.completed() === 1);
    checks.saved = [...played];
    run.stop();

    // mixed: no mode, and the starting map is any the server has
    run = await open();
    await wait("the game modes", () => Boolean(card("Mixed")));
    card("Mixed")!.click();
    await wait("the pick", () => !button("Next")!.disabled);
    button("Next")!.click();
    await wait("every map", () => Boolean(card("pl_badwater")));
    checks.mixedAllMaps = Boolean(card("cp_dustbowl")) && Boolean(card("ctf_2fort"));
    // the wiki tells maps of one name apart by mode; the card shows its mode beside the name, so the name is left plain
    checks.modeNotRepeated = lines(card("cp_dustbowl")!).includes("Dustbowl") && lines(card("cp_dustbowl")!).includes("Control Point") && !lines(card("cp_dustbowl")!).some((line) => line!.includes("(Control Point)"));
    checks.mixedDefault = card("ctf_2fort")!.getAttribute("aria-pressed") === "true";
    button("Finish Setup")!.click();
    await wait("setup to complete", () => run.completed() === 1);
    checks.mixedSaved = [...played];
    run.stop();

    // the wiki can't be asked: the step says so, with the reason, and the modes are still there to choose
    const wiki = pictures;
    pictures = () => { throw new Error("Couldn't reach Test Wiki for map pictures: connection refused"); };
    run = await open(false);
    await wait("the pictures failure", () => text().includes("Map pictures unavailable"));
    checks.picturesReason = text().includes("connection refused");
    checks.modesStillChoosable = Boolean(card("Capture the Flag")) && cardImage("Capture the Flag") === null;
    run.stop();

    // the maps can't be read: no choice is offered, and the failure says why
    pictures = wiki;
    mapsFails = "No maps folder; install the game in Updates first";
    run = await open();
    await wait("the maps failure", () => text().includes("Couldn't read Team Fortress 2's maps"));
    checks.mapsReason = text().includes("install the game in Updates first");
    checks.noChoiceWithoutMaps = !card("Mixed") && button("Next")!.disabled;
    run.stop();
    mapsFails = "";

    // the last install's final stage is still in state: a new download's rows start unticked
    const { setInstallProgress } = await import("../../src/lib/server");
    const ticks = () => [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent === "check").length;
    setInstallProgress({ stage: "completed", percent: 100 });
    let stop = render(() => <PaperProvider>{sourceUI(TF2, tf2).create({} as any).setup({ onComplete: () => {} } as any)}</PaperProvider>, root);
    await wait("the download to start", () => text().includes("Downloading Team Fortress 2") && installCalls > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    checks.staleUnticked = ticks();
    finishDownload();
    await wait("the download to finish", () => Boolean(button("Next") && !button("Next")!.disabled));
    stop();

    // setup left after the download opens at the game mode, without downloading again
    downloaded = true;
    installCalls = 0;
    stop = render(() => <PaperProvider>{sourceUI(TF2, tf2).create({} as any).setup({ onComplete: () => {} } as any)}</PaperProvider>, root);
    await wait("the game modes", () => Boolean(heading("Game Mode")) && Boolean(card("Capture the Flag")));
    checks.reopensAtMode = installCalls === 0 && !button("Back") && button("Next")!.disabled;
    stop();
} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
