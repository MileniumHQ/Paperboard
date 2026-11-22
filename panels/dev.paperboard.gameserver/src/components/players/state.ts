// What the Players tab knows and does: the roster (the server's lists plus
// everyone with data in this world), the names players have now, which player
// is open, and every change to them. The tab draws it: what couldn't be read
// stands above the roster, a change that failed is a toast.
import { keepUnchanged, createLatest, createPolling, createRead, showError } from "@mileniumhq/paperui";
import { batch, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { useServer } from "../../lib/server";
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
    banned: boolean;
    banReason: string | null;
}

export type PlayerFlagField = "op" | "whitelisted";

const playerKey = (player: Pick<PlayerInfo, "name" | "uuid">) => (player.uuid ?? player.name).toLowerCase();

export function createPlayers() {
    const server = useServer();
    const { calls, onlinePlayerNames, seenPlayerNames } = server;
    const [listed, setListed] = createSignal<PlayerInfo[]>([]);
    // asked or being asked this visit; the service caches answers for an hour
    const requestedNames = new Set<string>();
    const [openKey, setOpenKey] = createSignal<string | undefined>();
    // why the lists or who is online couldn't be read, until they are read again
    const [rosterError, setRosterError] = createSignal("");
    const [onlineError, setOnlineError] = createSignal("");
    // how Floodgate names Bedrock players; null without crossplay
    const [bedrock, setBedrock] = createSignal<BedrockNaming | null>(null);

    // asks Mojang (through the service) once per uuid per visit; the service
    // holds the single name cache and returns fresh names on subsequent reads
    const refreshNames = (uuids: string[]) => {
        const wanted = uuids.map((u) => u.toLowerCase()).filter((u) => !requestedNames.has(u));
        if (wanted.length === 0) return;
        for (const uuid of wanted) requestedNames.add(uuid);
        calls
            .currentPlayerNames({ uuids: wanted })
            .then((names) => {
                const resolved = new Map(Object.entries(names ?? {}).map(([u, name]) => [u.toLowerCase(), name]));
                if (resolved.size === 0) return;
                batch(() => {
                    setListed((prev) =>
                        prev.map((p) => {
                            const next = p.uuid ? resolved.get(p.uuid.toLowerCase()) : undefined;
                            return next && next !== p.name ? { ...p, name: next } : p;
                        }),
                    );
                    stats.set((prev) =>
                        prev?.map((entry) => {
                            const next = resolved.get(entry.uuid.toLowerCase());
                            return next && next !== entry.name ? { ...entry, name: next } : entry;
                        }),
                    );
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
            const roster = (await calls.listRoster()) ?? [];
            if (!current()) return;
            batch(() => {
                setRosterError("");
                setListed(roster);
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
    const allPlayers = createMemo(() => {
        const byUuid = new Map<string, PlayerInfo>();
        const list: PlayerInfo[] = [];
        for (const player of listed()) {
            list.push(player);
            if (player.uuid) byUuid.set(player.uuid.toLowerCase(), player);
        }
        for (const summary of playerStatSummaries().values()) {
            const uuid = summary.uuid.toLowerCase();
            if (byUuid.has(uuid)) continue;
            const entry: PlayerInfo = { name: summary.name, uuid, whitelisted: false, op: false, banned: false, banReason: null };
            byUuid.set(uuid, entry);
            list.push(entry);
        }
        // online and recently seen players not on file yet (their first
        // session has not been saved)
        const seenNames = new Set(list.map((p) => p.name.toLowerCase()));
        for (const name of [...seenPlayerNames(), ...onlinePlayerNames()]) {
            if (seenNames.has(name)) continue;
            seenNames.add(name);
            list.push({ name, whitelisted: false, op: false, banned: false, banReason: null });
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
        const key = openKey();
        return key === undefined ? undefined : allPlayers().find((p) => playerKey(p) === key);
    });
    const setOpenName = (name: string | undefined) => {
        if (name === undefined) {
            setOpenKey(undefined);
            return;
        }
        const player = find(name);
        setOpenKey(player ? playerKey(player) : name.toLowerCase());
    };

    // a failed change is a toast whose title names what did not happen: "Couldn't ban Steve"
    const callPlayerAction = async (
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
        const key = (uuid ?? playerName).toLowerCase();
        const lower = playerName.toLowerCase();
        setListed((prev) =>
            prev.some((p) => playerKey(p) === key || p.name.toLowerCase() === lower)
                ? prev.map((p) => (playerKey(p) === key || p.name.toLowerCase() === lower ? { ...p, [field]: value } : p))
                // a player known only from their stats or a session joins the lists
                : [...prev, { name: playerName, uuid, whitelisted: false, op: false, banned: false, banReason: null, [field]: value }],
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
        if (!(await callPlayerAction(playerName, failure, () => calls[actionId]({ player: playerName, uuid: player?.uuid })))) return false;
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
            ? await callPlayerAction(playerName, (name) => `ban ${name}`, () => calls.banPlayer({ player: playerName, reason }))
            : await callPlayerAction(playerName, (name) => `pardon ${name}`, () => calls.pardonPlayer({ player: playerName }));
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
        const added = listed().find((p) => p.name.toLowerCase() === name.toLowerCase());
        batch(() => {
            if (!added) markFlag(name, undefined, "whitelisted", true);
            setOpenKey(added ? playerKey(added) : name.toLowerCase());
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
        // the service already cleared its state for this player; reload lists,
        // stats and state so a player on no list leaves the roster right away
        await Promise.all([
            loadRoster(),
            stats.reload(),
            server.refresh().catch((err) => showError("Couldn't refresh the server state", errorMessage(err))),
        ]);
        if (!openPlayer()) setOpenKey(undefined);
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
        /** the players' numbers from the world's stats files */
        leaderboard: createLeaderboard(playerStatSummaries),
        /** the server's lists, without players known only from their data */
        listed,
        all: allPlayers,
        find,
        bedrock,
        setOpenName,
        openPlayer,
        setFlag,
        setBanned,
        kick: (playerName: string, reason?: string) => callPlayerAction(playerName, (name) => `kick ${name}`, () => calls.kickPlayer({ player: playerName, reason })),
        kill: (playerName: string) => callPlayerAction(playerName, (name) => `kill ${name}`, () => calls.killPlayer({ player: playerName })),
        whitelistName,
        deleteOpenData,
    };
}

export type PlayersState = ReturnType<typeof createPlayers>;
