// What the Players tab knows and does: the roster (the server's lists plus
// everyone with data in this world), the names players have now, who is
// banned, which player is open, and every change to them. The tab draws it:
// what couldn't be read stands above the roster, a change that failed is a toast.
import { keepUnchanged, createLatest, createPolling, createRead, showError } from "@mileniumhq/paperui";
import { batch, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { useServer } from "../../lib/server";
import { type CallName } from "../../service/contract";
import type { BedrockNaming } from "../../core/bedrock";
import { errorMessage } from "../../lib/failure";
import { createLeaderboard } from "./leaderboard";

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
    banReason: string | null;
}

export type PlayerFlagField = "op" | "whitelisted";

export function createPlayers() {
    const server = useServer();
    const { calls, onlinePlayerNames, seenPlayerNames } = server;
    const [players, setPlayers] = createSignal<PlayerInfo[]>([]);
    // banned players by lowercased name, with the reason the ban list gives
    const [bannedNames, setBannedNames] = createSignal<Map<string, string | null>>(new Map());
    // the names players have now, by uuid: a renamed player is shown by
    // their new name even before they rejoin
    const [currentNames, setCurrentNames] = createSignal<Map<string, string>>(new Map());
    // asked or being asked this visit; a failed ask is asked again
    const requestedNames = new Set<string>();
    const [openName, setOpenName] = createSignal<string | undefined>();
    // why the lists or who is online couldn't be read, until they are read again
    const [rosterError, setRosterError] = createSignal("");
    const [onlineError, setOnlineError] = createSignal("");
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
        calls
            .currentPlayerNames({ uuids: wanted })
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
                        const next = new Map(prev);
                        for (const p of renamed) {
                            const old = p.name.toLowerCase();
                            if (!next.has(old)) continue;
                            const reason = next.get(old)!;
                            next.delete(old);
                            next.set(names[p.uuid!.toLowerCase()].toLowerCase(), reason);
                        }
                        return next;
                    });
                    setPlayers(withCurrentNames);
                    if (open?.uuid && names[open.uuid.toLowerCase()]) setOpenName(names[open.uuid.toLowerCase()]);
                });
            })
            .catch((err) => {
                for (const uuid of wanted) requestedNames.delete(uuid);
                showError("Couldn't update the players' names", errorMessage(err));
            });
    };

    // whitelist, operators and bans, by uuid, from the service; the files
    // are the truth, so this runs again after anything that changes them
    const latestRoster = createLatest();
    const loadRoster = async (): Promise<void> => {
        const current = latestRoster();
        try {
            const answer = await calls.listRoster();
            if (!current()) return;
            const roster = answer ?? [];
            const listed = withCurrentNames(roster.map(({ banned: _banned, banReason: _reason, ...player }) => player));
            batch(() => {
                setRosterError("");
                setPlayers(listed);
                setBannedNames(new Map(listed.flatMap((p, i) => (roster[i].banned ? [[p.name.toLowerCase(), roster[i].banReason] as const] : []))));
            });
            refreshNames(roster.map((p) => p.uuid));
        } catch (err) {
            if (!current()) return;
            setRosterError(errorMessage(err));
        }
    };

    // offline stats from the world's files, by uuid; a poll that reads the
    // same numbers keeps every entry it had, and a failed read says why
    // instead of leaving the last numbers (or none) looking current
    const stats = createRead(async () => (await calls.listPlayerStats()).filter((entry) => entry && typeof entry.uuid === "string"), {
        key: "uuid",
        message: errorMessage,
    });
    const playerStatSummaries = createMemo(() => new Map((stats.value() ?? []).map((entry) => [entry.uuid.toLowerCase(), entry])));
    createPolling(() => stats.reload(), STATS_POLL_MS);

    // who is online arrives as state; asking can fail, and says so
    const askOnline = () =>
        calls.queryOnlinePlayers().then(
            () => void setOnlineError(""),
            (err) => void setOnlineError(errorMessage(err)),
        );
    createPolling(askOnline, LIST_POLL_MS, { immediate: true });

    onMount(() => {
        void loadRoster();
        calls
            .readBedrockNaming()
            .then((naming) => setBedrock(naming ?? null))
            .catch((err) => showError("Couldn't read the Bedrock names", errorMessage(err)));
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
    /** why a banned player is banned, as the ban list says; null when it says nothing or they aren't */
    const banReason = (name: string) => bannedNames().get(name.toLowerCase()) ?? null;

    // a failed change is a toast whose title names what did not happen: "Couldn't ban Steve"
    const callPlayerAction = async (
        actionId: CallName,
        playerName: string,
        failure: (name: string) => string,
        run: () => Promise<unknown>,
    ): Promise<boolean> => {
        try {
            await run();
            return true;
        } catch (err) {
            showError(`Couldn't ${failure(playerName)}`, errorMessage(err));
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

    /** ops or whitelists a player, or takes it back; a failure is a toast */
    const setFlag = async (playerName: string, field: PlayerFlagField, value: boolean): Promise<boolean> => {
        const actionId =
            field === "op"
                ? value ? "opPlayer" : "deopPlayer"
                : value ? "whitelistPlayer" : "unwhitelistPlayer";
        const failure = (name: string) =>
            field === "op"
                ? value ? `make ${name} an operator` : `remove ${name} as an operator`
                : value ? `whitelist ${name}` : `remove ${name} from the whitelist`;
        const player = find(playerName);
        if (!(await callPlayerAction(actionId, playerName, failure, () => calls[actionId]({ player: playerName, uuid: player?.uuid })))) return false;
        // the service answers once the list is written, by the server or itself: read it back.
        // Floodgate writes a Bedrock player's whitelist a moment later, so the switch keeps
        // what it will write; a player taken off every list has left the roster
        await loadRoster();
        if (value || find(playerName)) markFlag(playerName, player?.uuid, field, value);
        return true;
    };

    /** bans or pardons; the service answers once the server has written its ban list, which is read back */
    const setBanned = async (playerName: string, banned: boolean, reason?: string): Promise<boolean> => {
        const done = banned
            ? await callPlayerAction("banPlayer", playerName, (name) => `ban ${name}`, () => calls.banPlayer({ player: playerName, reason }))
            : await callPlayerAction("pardonPlayer", playerName, (name) => `pardon ${name}`, () => calls.pardonPlayer({ player: playerName }));
        if (done) await loadRoster();
        return done;
    };

    /**
     * Whitelists a name that may not be on the roster yet (a player who has
     * not joined) and opens them. Throws the service's refusal.
     */
    const whitelistName = async (name: string): Promise<void> => {
        await calls.whitelistPlayer({ player: name });
        // the list now holds the account's own casing; Floodgate writes a Bedrock player's a moment later
        await loadRoster();
        const added = players().find((p) => p.name.toLowerCase() === name.toLowerCase());
        batch(() => {
            if (!added) markFlag(name, undefined, "whitelisted", true);
            setOpenName(added ? nameOf(added) : name);
        });
    };

    // what the service forgot of a player whose data it deleted, before its
    // push says so; their uuid also drops the offline stats, which would
    // otherwise list them again until the next stats poll
    const forget = (name: string, uuid?: string) => {
        const key = name.toLowerCase();
        const without = <V,>(map: ReadonlyMap<string, V>) => Object.fromEntries([...map].filter(([k]) => k !== key));
        if (uuid) stats.set((prev) => prev?.filter((entry) => entry.uuid.toLowerCase() !== uuid.toLowerCase()));
        server.patch({
            seenPlayers: server.seenPlayers().filter((n) => n !== key),
            onlinePlayers: server.onlinePlayers().filter((n) => n !== key),
            playerStats: without(server.playerStats()),
            playerPlaytime: without(server.playerPlaytime()),
            playerPositions: without(server.playerPositions()),
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
            await calls.deletePlayerData({ player: player.name, uuid: player.uuid });
        } catch (err) {
            showError(`Couldn't delete ${player.name}'s data`, errorMessage(err));
            return;
        }
        forget(player.name, player.uuid);
        // a player on the whitelist, an operator or banned stays listed,
        // now without data; anyone else leaves the roster
        await loadRoster();
        await stats.reload();
        if (!find(player.name)) setOpenName(undefined);
    };

    return {
        /** why the server's lists couldn't be read, until they are read again; "" while they can */
        rosterError,
        reloadRoster: loadRoster,
        /** why who is online couldn't be asked, until it is asked again */
        onlineError,
        askOnline,
        /** why the world's stats files couldn't be read, and whether a read is out */
        stats: { error: stats.error, loading: stats.loading, reload: stats.reload },
        /** the players' numbers: the world's stats files, else this session's count */
        leaderboard: createLeaderboard(playerStatSummaries, server.playerPlaytime),
        /** the server's lists, without players known only from their data */
        listed: players,
        all: allPlayers,
        find,
        isBanned,
        banReason,
        bedrock,
        openName,
        setOpenName,
        openPlayer,
        setFlag,
        setBanned,
        kick: (playerName: string, reason?: string) => callPlayerAction("kickPlayer", playerName, (name) => `kick ${name}`, () => calls.kickPlayer({ player: playerName, reason })),
        kill: (playerName: string) => callPlayerAction("killPlayer", playerName, (name) => `kill ${name}`, () => calls.killPlayer({ player: playerName })),
        whitelistName,
        deleteOpenData,
    };
}

export type PlayersState = ReturnType<typeof createPlayers>;
