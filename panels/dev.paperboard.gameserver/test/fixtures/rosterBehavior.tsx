// Every game's Players tab (Terraria, Palworld, Team Fortress 2) on real
// PaperUI over a fake service: the same roster, the same Kick and Ban, and
// every refusal on screen with its reason. Opened as
// rosterBehavior.html?server=online or ?server=offline by test/rosterBehavior.test.ts.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";
import { initialServerState } from "../../src/service/initialState";
import { serverStateKey } from "../../src/servers";

const mode = new URL(location.href).searchParams.get("server") ?? "";
const checks: Record<string, unknown> = {};
const uncaught: string[] = [];
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
const calls: { action: string; input: unknown }[] = [];
const status = mode === "online" ? "online" : "offline";
const state = {
    servers: [{ id: mode, name: "Fixture", game: "terraria", directory: `servers/${mode}`, createdAt: 1, configured: true, icon: null, state: { serverStatus: status, serverSoftware: "vanilla", serverVersion: "1.4.5.8", serverPort: "7777", recoveryBlock: null, maxPlayers: 8, playerCount: 1 } }],
    serversError: null,
    [serverStateKey(mode)]: { ...initialServerState(), serverStatus: status, serverSoftware: "vanilla", serverVersion: "1.4.5.8", onlinePlayers: status === "online" ? ["Alex"] : [] },
};
const DAY = 86_400_000;
const roster: Record<string, unknown> = {
    "terraria-players": { seen: [{ name: "Alex", lastSeen: Date.now(), address: "203.0.113.7:51234" }, { name: "Sam", lastSeen: Date.now() - 3 * DAY, address: "192.0.2.9:50333" }], bans: [{ name: "Sam", address: "192.0.2.9" }] },
    "palworld-players": { seen: [{ userId: "steam_1", name: "Jules", accountName: "j", level: 31, lastSeen: Date.now() - DAY }], bans: [], online: [] },
    "team-fortress-2-players": {
        seen: [
            { steamId: "STEAM_0:1:1", name: "Pat", lastSeen: Date.now() - DAY, kills: 3 },
            { steamId: "STEAM_0:1:2", name: "Pat", lastSeen: Date.now() - 2 * DAY },
        ],
        bans: [],
        online: [{ userId: 7, name: "Bot Heavy", steamId: "BOT", team: "Red", role: "heavyweapons", since: Date.now() - 600_000, stats: { kills: 1, deaths: 0, assists: 0, dominations: 0, playtime: 0 } }],
        admins: null,
    },
};
const refused: Record<string, string> = {
    "terraria-ban": "Paperboard has no address for Alex yet",
    "palworld-players": "palworld-players.json is damaged; fix or remove it in Files",
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string, input?: unknown) => {
    const name = action.slice(action.indexOf("/") + 1);
    if (action === "__getState") return state;
    calls.push({ action: name, input });
    if (mode === "offline" && name === "palworld-players") throw new Error(refused["palworld-players"]);
    if (refused[name] && name !== "palworld-players") throw new Error(refused[name]!);
    return roster[name] ?? {};
}) as typeof actionsApi.call;

const wait = async (what: string, predicate: () => boolean) => {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}: ${document.body.innerText.slice(0, 400)}`);
};
const text = () => document.body.innerText;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string) => buttons().find((b) => b.textContent?.trim().endsWith(label));
const rowNames = () => [...document.querySelectorAll<HTMLInputElement>("input[name=playersList]")].map((i) => i.value);
const openPlayer = async (name: string) => {
    await wait(`${name} in the roster`, () => rowNames().includes(name));
    document.querySelector<HTMLInputElement>(`input[name=playersList][value="${name}"]`)!.click();
    await wait(`${name}'s detail`, () => Boolean(button("Kick")));
};

let error = "";
try {
    const root = document.getElementById("app")!;
    if (mode === "online") {
        const { default: TerrariaPlayers } = await import("../../src/games/terraria/Players");
        const stopTerraria = render(() => <PaperProvider><TerrariaPlayers /></PaperProvider>, root);
        await openPlayer("Alex");
        checks.terrariaRows = rowNames();
        checks.terrariaOnlineCanBeKicked = !button("Kick")!.disabled;
        checks.terrariaDetailsAddress = text().includes("203.0.113.7:51234");
        button("Kick")!.click();
        await wait("the kick", () => calls.some((c) => c.action === "terraria-kick"));
        checks.terrariaKick = calls.find((c) => c.action === "terraria-kick");
        // a refused ban is told in the dialog with the player and the reason
        button("Ban")!.click();
        await wait("the Ban dialog", () => text().includes("Ban Alex"));
        checks.banDialogNote = text().includes("anyone else joining from it is turned away too. An online player is removed at once.");
        [...document.querySelectorAll<HTMLButtonElement>("footer button, [role=dialog] button")].filter((b) => b.textContent?.trim() === "Ban").at(-1)!.click();
        await wait("the ban refusal", () => text().includes("Alex was not banned"));
        checks.banRefusalTitled = true;
        checks.banRefusalReason = text().includes("Paperboard has no address for Alex yet");
        stopTerraria();
        root.innerHTML = "";

        const { TF2 } = await import("../../src/games/tf2/index");
        const { default: SourcePlayers } = await import("../../src/games/source/Players");
        const stopSource = render(() => <PaperProvider><SourcePlayers spec={TF2} /></PaperProvider>, root);
        await wait("the Source roster", () => rowNames().length === 3);
        // two Pats are told apart by their Steam ids; a bot keeps its name
        checks.sourceRows = rowNames();
        await openPlayer("Bot Heavy");
        checks.botCannotBeBanned = !button("Ban") && !button("Unban");
        checks.botHasNoDetails = !text().includes("Steam id");
        stopSource();
        root.innerHTML = "";
    } else {
        const { default: PalworldPlayers } = await import("../../src/games/palworld/Players");
        render(() => <PaperProvider><PalworldPlayers /></PaperProvider>, root);
        // a roster the service cannot read is quoted with the reason
        await wait("the load failure", () => text().includes("Players not loaded"));
        checks.loadFailureReason = text().includes("palworld-players.json is damaged");
    }
} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.calls = calls;
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
