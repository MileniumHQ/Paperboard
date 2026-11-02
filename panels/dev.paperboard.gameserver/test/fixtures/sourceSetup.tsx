// Team Fortress 2's setup as a person meets it (real browser, real PaperUI): after the install, the
// game mode as picture cards, then the starting map; Finish Setup saves through the service and
// says so when the service refuses. The service is stood in for at the Actions boundary only.
// Opened as sourceSetup.html?server=s1 by test/sourceSetup.test.ts.
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

let installed = ["ctf_2fort", "ctf_turbine", "pl_badwater", "cp_dustbowl", "zz_unlisted"];
let pictures: () => unknown = () => ({ source: { name: "Test Wiki", url: "https://wiki.example/maps" }, pictures: { ctf_2fort: "https://wiki.example/ctf_2fort.png", cp_dustbowl: "https://wiki.example/cp_dustbowl.png" } });
let play: (input: any) => unknown = () => ({});
let mapsFails = "";
const played: any[] = [];
const state = {
    servers: [{ id: "s1", name: "Fixture", game: "team-fortress-2", directory: "servers/s1", createdAt: 1, configured: false, icon: null, state: { serverStatus: "offline", serverSoftware: "steam", serverVersion: "", serverPort: "27015", recoveryBlock: null, maxPlayers: 24, playerCount: 0 } }],
    serversError: null,
    [serverStateKey("s1")]: { ...initialServerState() },
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string, input: any) => {
    if (action === "__getState") return state;
    if (action === "s1/team-fortress-2-info") return { host: { supported: true }, build: null, version: null };
    if (action === "s1/team-fortress-2-install") return true;
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
const cardImage = (title: string) => card(title)?.querySelector("img")?.getAttribute("src") ?? null;

let error = "";
try {
    const { sourceUI } = await import("../../src/games/source/ui");
    const { tf2, TF2 } = await import("../../src/games/tf2");
    const root = document.getElementById("app")!;

    const open = async () => {
        played.length = 0;
        let completed = 0;
        const stop = render(() => <PaperProvider>{sourceUI(TF2, tf2).create({} as any).setup({ onComplete: () => { completed++; }, initialSoftware: "", initialVersion: "" } as any)}</PaperProvider>, root);
        await wait("the install to finish", () => Boolean(button("Next") && !button("Next")!.disabled));
        button("Next")!.click();
        return { completed: () => completed, stop };
    };

    // the modes: those the game lists with an installed map, each drawn by one of its maps, and a mixed choice
    let run = await open();
    await wait("the game modes", () => Boolean(card("Capture the Flag")));
    checks.modes = ["Capture the Flag", "Control Point", "Payload", "Mixed", "Arena"].map((title) => Boolean(card(title)));
    checks.unlistedMapHidden = !text().includes("zz_unlisted");
    checks.modeCounts = text().includes("2 maps") && text().includes("1 map");
    checks.ctfDrawnByItsMap = cardImage("Capture the Flag");
    checks.noPictureNoIcon = cardImage("Payload");
    checks.attribution = text().includes("Map pictures from Test Wiki");
    checks.finishWaitsForAMode = button("Finish Setup")!.disabled;

    // the starting map, within the mode; the first is already chosen, so Finish is open
    card("Capture the Flag")!.click();
    await wait("the starting maps", () => Boolean(card("ctf_turbine")));
    checks.mapsOfTheMode = !text().includes("pl_badwater") && Boolean(card("ctf_2fort"));
    checks.firstMapChosen = card("ctf_2fort")!.getAttribute("aria-pressed") === "true";
    checks.finishOpen = !button("Finish Setup")!.disabled;
    card("ctf_turbine")!.click();
    await wait("the new choice", () => card("ctf_turbine")!.getAttribute("aria-pressed") === "true");
    checks.choiceMoves = card("ctf_2fort")!.getAttribute("aria-pressed") === "false";
    checks.nothingSavedBeforeFinish = played.length === 0;

    // a service that refuses: setup says why, stays, and the same choice can be tried again
    play = () => { throw new Error("ctf_turbine is not installed"); };
    button("Finish Setup")!.click();
    await wait("the refusal", () => text().includes("Setup is not finished"));
    checks.refusalReason = text().includes("ctf_turbine is not installed");
    checks.refusedStays = run.completed() === 0 && text().includes("Where does it start?");
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
    await wait("every map", () => Boolean(card("pl_badwater")));
    checks.mixedAllMaps = Boolean(card("cp_dustbowl")) && Boolean(card("ctf_2fort"));
    checks.mixedDefault = card("ctf_2fort")!.getAttribute("aria-pressed") === "true";
    button("Finish Setup")!.click();
    await wait("setup to complete", () => run.completed() === 1);
    checks.mixedSaved = [...played];
    run.stop();

    // the wiki can't be asked: the step says so, with the reason, and the modes are still there to choose
    pictures = () => { throw new Error("Couldn't reach Test Wiki for map pictures: connection refused"); };
    run = await open();
    await wait("the pictures failure", () => text().includes("Map pictures unavailable"));
    checks.picturesReason = text().includes("connection refused");
    checks.modesStillChoosable = Boolean(card("Capture the Flag")) && cardImage("Capture the Flag") === null;
    run.stop();

    // the maps can't be read: no choice is offered, and the failure says why
    mapsFails = "No maps folder; install the game in Updates first";
    run = await open();
    await wait("the maps failure", () => text().includes("Couldn't read Team Fortress 2's maps"));
    checks.mapsReason = text().includes("install the game in Updates first");
    checks.noChoiceWithoutMaps = !card("Mixed") && button("Finish Setup")!.disabled;
    run.stop();
} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
