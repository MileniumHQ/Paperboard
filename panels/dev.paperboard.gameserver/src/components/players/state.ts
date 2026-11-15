// What the Players tab knows and does: the roster (the server's lists plus
// everyone with data in this world), the names players have now, who is
// banned, which player is open, and every change to them. The tab draws it;
// every failure lands in `feedback`.
import { keepUnchanged, createLatest } from "@mileniumhq/paperui/headless";
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import {
    forgetPlayerData,
    loadPlayerStats,
    onlinePlayerNames,
    playerStatSummaries,
    queryOnlinePlayers,
    seenPlayerNames,
    serverBridge,
    serverStatus,
} from "../../lib/server";
import { CALLS, type CallName } from "../../service/contract";
import type { BedrockNaming } from "../../core/bedrock";
import { errorMessage, type Outcome } from "../../lib/failure";

const LIST_POLL_MS = 15000;
const STATS_POLL_MS = 30000;

export interface PlayerInfo {
    name: string;
    uuid?: string;
    whitelisted: boolean;
    op: boolean;
}

/** service/playerLists.ts RosterEntry */
interface RosterEntry extends PlayerInfo {
    uuid: string;
    banned: boolean;
}

export type PlayerFlagField = "op" | "whitelisted";

export function createPlayers() {
    const [players, setPlayers] = createSignal<PlayerInfo[]>([]);
    const [bannedNames, setBannedNames] = createSignal<Set<string>>(new Set());
    // the names players have now, by uuid: a renamed player is shown by
    // their new name even before they rejoin
    const [currentNames, setCurrentNames] = createSignal<Map<string, string>>(new Map());
    // asked or being asked this visit; a failed ask is asked again
    const requestedNames = new Set<string>();
    const [openName, setOpenName] = createSignal<string | undefined>();
    const [feedback, setFeedback] = createSignal<Outcome | undefined>();
    // how Floodgate names Bedrock players; null without crossplay
    const [bedrock, setBedrock] = createSignal<BedrockNaming | null>(null);

    const nameOf = (player: PlayerInfo) =>
        (player.uuid && currentNames().get(player.uuid.toLowerCase())) || player.name;

    // rows keep their objects (PlayerRoster rebuilds a row whose object
    // changes), so a new name replaces only the renamed player's entry
    const withCurrentNames = (list: PlayerInfo[]) =>
        list.map((p) => (nameOf(p) === p.name ? p : { ...p, name: nameOf(p) }));

    // asks Mojang (through the service) once per uuid per visit; the
    // service caches answers for an hour
    const refreshNames = (uuids: string[]) => {
        const wanted = uuids.map((u) => u.toLowerCase()).filter((u) => !requestedNames.has(u));
        if (wanted.length === 0) return;
        for (const uuid of wanted) requestedNames.add(uuid);
        serverBridge
            .call<Record<string, string>>(CALLS.currentPlayerNames, { uuids: wanted })
            .then((names) => {
                const entries = Object.entries(names ?? {});
                if (entries.length === 0) return;
                // keep the open player open under their new name
                const open = openPlayer();
                batch(() => {
                    setCurrentNames((prev) => {
                        const next = new Map(prev);
                        for (const [uuid, name] of entries) next.set(uuid.toLowerCase(), name);
                        return next;
                    });
                    // a ban is shown by name: carry it over to the new one
                    const renamed = players().filter((p) => p.uuid && names[p.uuid.toLowerCase()]);
                    setBannedNames((prev) => {
                        const next = new Set(prev);
                        for (const p of renamed) {
                            if (!next.delete(p.name.toLowerCase())) continue;
                            next.add(names[p.uuid!.toLowerCase()].toLowerCase());
                        }
                        return next;
                    });
                    setPlayers(withCurrentNames);
                    if (open?.uuid && names[open.uuid.toLowerCase()]) setOpenName(names[open.uuid.toLowerCase()]);
                });
            })
            .catch((err) => {
                for (const uuid of wanted) requestedNames.delete(uuid);
                console.error("[Players] current-player-names failed:", err);
                setFeedback({ title: "Player names not updated", message: errorMessage(err) });
            });
    };

    // whitelist, operators and bans, by uuid, from the service; the files
    // are the truth, so this runs again after anything that changes them
    const latestRoster = createLatest();
    const loadRoster = async (): Promise<void> => {
        const current = latestRoster();
        try {
            const answer = await serverBridge.call<RosterEntry[]>(CALLS.listRoster);
            if (!current()) return;
            const roster = answer ?? [];
            const listed = withCurrentNames(roster.map(({ banned: _banned, ...player }) => player));
            batch(() => {
                setPlayers(listed);
                setBannedNames(new Set(listed.filter((_, i) => roster[i].banned).map((p) => p.name.toLowerCase())));
            });
            refreshNames(roster.map((p) => p.uuid));
        } catch (err) {
            if (!current()) return;
            console.error("[Players] list-roster failed:", err);
            setFeedback({ title: "Players not loaded", message: errorMessage(err) });
        }
    };

    // offline stats from the world's files; a failed read says why instead
    // of leaving the last numbers (or none) looking current
    const reloadStats = () =>
        loadPlayerStats().catch((err) => {
            console.error("[Players] list-player-stats failed:", err);
            setFeedback({ title: "Player stats not loaded", message: errorMessage(err) });
        });

    // who is online arrives as state; asking can fail, and says so
    const askOnline = () =>
        queryOnlinePlayers().catch((err) => setFeedback({ title: "Online players not read", message: errorMessage(err) }));

    onMount(() => {
        void askOnline();
        void reloadStats();
        const poll = setInterval(() => void askOnline(), LIST_POLL_MS);
        const statsPoll = setInterval(() => void reloadStats(), STATS_POLL_MS);
        onCleanup(() => {
            clearInterval(poll);
            clearInterval(statsPoll);
        });
        void loadRoster();
        serverBridge
            .call<BedrockNaming | null>(CALLS.readBedrockNaming)
            .then((naming) => setBedrock(naming ?? null))
            .catch((err) => {
                console.error("[Players] read-bedrock-naming failed:", err);
                setFeedback({ title: "Bedrock names not read", message: errorMessage(err) });
            });
    });

    // players known only from their stats files get current names too
    createEffect(on(playerStatSummaries, (summaries) => refreshNames([...summaries.keys()])));

    // the roster is the server's lists plus everyone with data in this
    // world, one row per uuid; usercache.json is only a name book (the
    // server keeps writing it back), so a player whose data was deleted
    // and who is on no list is gone for good. Each player keeps one object
    // (by uuid, else by name) for as long as nothing about them changes, so
    // their row, and its head, stays while the rest of the roster updates.
    let known = new Map<string, PlayerInfo>();
    const playerKey = (player: PlayerInfo) => (player.uuid ?? player.name).toLowerCase();
    const allPlayers = createMemo(() => {
        const byUuid = new Map<string, PlayerInfo>();
        const list: PlayerInfo[] = [];
        for (const player of players()) {
            list.push(player);
            if (player.uuid) byUuid.set(player.uuid.toLowerCase(), player);
        }
        for (const summary of playerStatSummaries().values()) {
            const uuid = summary.uuid.toLowerCase();
            if (byUuid.has(uuid)) continue;
            const entry = { name: summary.name, uuid, whitelisted: false, op: false };
            entry.name = nameOf(entry);
            byUuid.set(uuid, entry);
            list.push(entry);
        }
        // online and recently seen players not on file yet (their first
        // session has not been saved)
        const listed = new Set(list.map((p) => p.name.toLowerCase()));
        for (const name of [...seenPlayerNames(), ...onlinePlayerNames()]) {
            if (listed.has(name)) continue;
            listed.add(name);
            list.push({ name, whitelisted: false, op: false });
        }
        const kept = new Map<string, PlayerInfo>();
        const stable = list.map((player) => {
            const key = playerKey(player);
            const previous = known.get(key);
            const same = previous ? keepUnchanged(previous, player) : player;
            kept.set(key, same);
            return same;
        });
        known = kept;
        return stable;
    });

    const find = (name: string) => allPlayers().find((p) => p.name === name);
    const openPlayer = createMemo(() => {
        const name = openName();
        return name === undefined ? undefined : find(name);
    });
    const isBanned = (name: string) => bannedNames().has(name.toLowerCase());

    // a failed change is quoted under the title naming what did not happen
    const callPlayerAction = async (
        actionId: CallName,
        playerName: string,
        failure: string,
        extra?: Record<string, unknown>,
    ): Promise<boolean> => {
        try {
            await serverBridge.call(actionId, { player: playerName, ...extra });
            setFeedback(undefined);
            return true;
        } catch (err) {
            console.error(`[Players] ${actionId} failed for "${playerName}":`, err);
            setFeedback({ title: `${playerName} was not ${failure}`, message: errorMessage(err) });
            return false;
        }
    };

    /** sets a player's flag as stored, adding a player who was on no list */
    const markFlag = (playerName: string, uuid: string | undefined, field: PlayerFlagField, value: boolean) => {
        const key = playerName.toLowerCase();
        setPlayers((prev) =>
            prev.some((p) => p.name.toLowerCase() === key)
                ? prev.map((p) => (p.name.toLowerCase() === key ? { ...p, [field]: value } : p))
                // a player known only from their stats or a session joins the lists
                : [...prev, { name: playerName, uuid, whitelisted: false, op: false, [field]: value }],
        );
    };

    /** ops or whitelists a player, or takes it back; the error is in `feedback` */
    const setFlag = async (playerName: string, field: PlayerFlagField, value: boolean): Promise<boolean> => {
        const actionId: CallName =
            field === "op"
                ? value ? CALLS.opPlayer : CALLS.deopPlayer
                : value ? CALLS.whitelistPlayer : CALLS.unwhitelistPlayer;
        const failure = field === "op" ? (value ? "made an operator" : "removed as an operator") : value ? "whitelisted" : "removed from the whitelist";
        const player = find(playerName);
        if (!(await callPlayerAction(actionId, playerName, failure, { uuid: player?.uuid }))) return false;
        markFlag(playerName, player?.uuid, field, value);
        // a stopped server's files were edited in place: read them back.
        // A running one writes them a moment after the command, so the
        // switch shows what it will write
        if (serverStatus() === "offline") await loadRoster();
        return true;
    };

    /** bans or pardons; the service answers once the server has written its ban list, which is read back */
    const setBanned = async (playerName: string, banned: boolean, reason?: string): Promise<boolean> => {
        const done = banned
            ? await callPlayerAction(CALLS.banPlayer, playerName, "banned", { reason })
            : await callPlayerAction(CALLS.pardonPlayer, playerName, "pardoned");
        if (done) await loadRoster();
        return done;
    };

    /**
     * Whitelists a name that may not be on the roster yet (a player who has
     * not joined) and opens them. Throws the service's refusal.
     */
    const whitelistName = async (name: string): Promise<void> => {
        await serverBridge.call(CALLS.whitelistPlayer, { player: name });
        if (serverStatus() === "offline") {
            // the file now holds the account's own casing
            await loadRoster();
            const added = players().find((p) => p.name.toLowerCase() === name.toLowerCase());
            setOpenName(added ? nameOf(added) : name);
            return;
        }
        batch(() => {
            markFlag(name, undefined, "whitelisted", true);
            setOpenName(name);
        });
    };

    /** moves the open player's data to the trash; a player on no list leaves the roster */
    const deleteOpenData = async () => {
        const player = openPlayer();
        if (!player) return;
        // service-owned: an online player is kicked and their files saved
        // out first, then trash-first delete under the actual level-name.
        // Without a uuid the service resolves one from the server's files
        try {
            await serverBridge.call(CALLS.deletePlayerData, { player: player.name, uuid: player.uuid });
        } catch (err) {
            console.error("[Players] Failed to delete player data:", err);
            setFeedback({ title: `${player.name}'s data was not deleted`, message: errorMessage(err) });
            return;
        }
        setFeedback(undefined);
        forgetPlayerData(player.name, player.uuid);
        // a player on the whitelist, an operator or banned stays listed,
        // now without data; anyone else leaves the roster
        await loadRoster();
        await reloadStats();
        if (!find(player.name)) setOpenName(undefined);
    };

    return {
        /** the server's lists, without players known only from their data */
        listed: players,
        all: allPlayers,
        find,
        isBanned,
        bedrock,
        feedback,
        setFeedback,
        openName,
        setOpenName,
        openPlayer,
        setFlag,
        setBanned,
        kick: (playerName: string, reason?: string) => callPlayerAction(CALLS.kickPlayer, playerName, "kicked", { reason }),
        kill: (playerName: string) => callPlayerAction(CALLS.killPlayer, playerName, "killed"),
        whitelistName,
        deleteOpenData,
    };
}

export type PlayersState = ReturnType<typeof createPlayers>;
