// What the Players tab knows and does: the roster the service reads (the
// server's lists, everyone with data in this world and who is on now), which
// player is open, and every change to them. The tab draws it: what couldn't
// be read stands above the roster, a change that failed is a toast.
import { createPolling, createRead, showError } from "@mileniumhq/paperui";
import { createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { useServer } from "../../lib/server";
import type { BedrockNaming } from "../../core/bedrock";
import type { RosterEntry } from "../../service/playerLists";
import { errorMessage } from "../../lib/failure";

const ONLINE_POLL_MS = 15000;
const ROSTER_POLL_MS = 30000;

export type PlayerInfo = RosterEntry;
export type PlayerFlagField = "op" | "whitelisted";

export function createPlayers() {
    const server = useServer();
    const { calls, onlinePlayerNames } = server;
    // rows are matched by key across reads, so a player's row and head stay
    // while the rest of the roster updates
    const roster = createRead(() => calls.listRoster(), { key: "key", message: errorMessage });
    const all = () => roster.value() ?? [];
    createPolling(() => roster.reload(), ROSTER_POLL_MS);
    // someone joining or leaving shows at once, not on the next poll
    createEffect(on(onlinePlayerNames, () => void roster.reload(), { defer: true }));

    // who is online arrives as state; asking can fail, and says so
    const [onlineError, setOnlineError] = createSignal("");
    const askOnline = () =>
        calls.queryOnlinePlayers().then(
            () => void setOnlineError(""),
            (err) => void setOnlineError(errorMessage(err)),
        );
    createPolling(askOnline, ONLINE_POLL_MS, { immediate: true });

    // how Floodgate names Bedrock players; null without crossplay
    const [bedrock, setBedrock] = createSignal<BedrockNaming | null>(null);
    onMount(() => {
        calls
            .readBedrockNaming()
            .then((naming) => setBedrock(naming ?? null))
            .catch((err) => showError("Couldn't read the Bedrock names", errorMessage(err)));
    });

    // the names players have now: the service asks Mojang once per uuid per
    // visit and keeps the answers for an hour, so the roster read after it
    // shows a renamed player by their new name
    const asked = new Set<string>();
    createEffect(
        on(roster.value, (rows) => {
            const wanted = (rows ?? []).flatMap((row) => (row.uuid && !asked.has(row.uuid) ? [row.uuid] : []));
            if (wanted.length === 0) return;
            for (const uuid of wanted) asked.add(uuid);
            calls
                .currentPlayerNames({ uuids: wanted })
                .then((names) => {
                    if (Object.keys(names ?? {}).length > 0) void roster.reload();
                })
                .catch((err) => {
                    for (const uuid of wanted) asked.delete(uuid);
                    showError("Couldn't update the players' names", errorMessage(err));
                });
        }),
    );

    const find = (name: string) => all().find((p) => p.name === name);
    const [openKey, setOpenKey] = createSignal<string | undefined>();
    const openPlayer = createMemo(() => {
        const key = openKey();
        return key === undefined ? undefined : all().find((p) => p.key === key);
    });
    const setOpenName = (name: string | undefined) => setOpenKey(name === undefined ? undefined : (find(name)?.key ?? name.toLowerCase()));

    // a failed change is a toast whose title names what did not happen: "Couldn't ban Steve"
    const attempt = async (failure: string, run: () => Promise<unknown>): Promise<boolean> => {
        try {
            await run();
            return true;
        } catch (err) {
            showError(`Couldn't ${failure}`, errorMessage(err));
            return false;
        }
    };

    /** a row's flag as it will be stored, adding a player who was on no list */
    const markFlag = (name: string, field: PlayerFlagField, value: boolean) =>
        roster.set((rows) => {
            const lower = name.toLowerCase();
            const list = rows ?? [];
            if (list.some((p) => p.name.toLowerCase() === lower)) return list.map((p) => (p.name.toLowerCase() === lower ? { ...p, [field]: value } : p));
            return [...list, { key: lower, uuid: null, name, whitelisted: false, op: false, banned: false, banReason: null, stats: null, [field]: value }];
        });

    /** ops or whitelists a player, or takes it back; a failure is a toast */
    const setFlag = async (name: string, field: PlayerFlagField, value: boolean): Promise<boolean> => {
        const call = field === "op" ? (value ? "opPlayer" : "deopPlayer") : value ? "whitelistPlayer" : "unwhitelistPlayer";
        const failure =
            field === "op"
                ? value ? `make ${name} an operator` : `remove ${name} as an operator`
                : value ? `whitelist ${name}` : `remove ${name} from the whitelist`;
        const uuid = find(name)?.uuid ?? undefined;
        if (!(await attempt(failure, () => calls[call]({ player: name, uuid })))) return false;
        // the service answers once the list is written: read it back. Floodgate
        // writes a Bedrock player's whitelist a moment later, so the switch
        // keeps what it will write until a later read has it
        await roster.reload();
        if (find(name)?.[field] !== value) markFlag(name, field, value);
        return true;
    };

    /** bans or pardons; the service answers once the server has written its ban list, which is read back */
    const setBanned = async (name: string, banned: boolean, reason?: string): Promise<boolean> => {
        const done = banned
            ? await attempt(`ban ${name}`, () => calls.banPlayer({ player: name, reason }))
            : await attempt(`pardon ${name}`, () => calls.pardonPlayer({ player: name }));
        if (done) await roster.reload();
        return done;
    };

    /** whitelists a name that may not be on the roster yet (a player who has not joined) and opens them; throws the service's refusal */
    const whitelistName = async (name: string): Promise<void> => {
        await calls.whitelistPlayer({ player: name });
        // the list holds the account's own casing; Floodgate writes a Bedrock player's a moment later
        await roster.reload();
        const added = all().find((p) => p.name.toLowerCase() === name.toLowerCase());
        if (!added?.whitelisted) markFlag(added?.name ?? name, "whitelisted", true);
        setOpenName(added?.name ?? name);
    };

    /** moves the open player's data to the trash; a player on no list leaves the roster */
    const deleteOpenData = async () => {
        const player = openPlayer();
        if (!player) return;
        // service-owned: an online player is kicked and their files saved out
        // first, then trash-first delete under the actual level-name. Without
        // a uuid the service resolves one from the server's files
        const done = await attempt(`delete ${player.name}'s data`, () => calls.deletePlayerData({ player: player.name, uuid: player.uuid ?? undefined }));
        if (!done) return;
        await Promise.all([roster.reload(), server.refresh().catch((err) => showError("Couldn't refresh the server state", errorMessage(err)))]);
    };

    return {
        /** why the roster couldn't be read, until it is read again; null while it can */
        error: roster.error,
        loading: roster.loading,
        reload: roster.reload,
        /** why who is online couldn't be asked, until it is asked again */
        onlineError,
        askOnline,
        all,
        find,
        bedrock,
        setOpenName,
        openPlayer,
        setFlag,
        setBanned,
        kick: (name: string, reason?: string) => attempt(`kick ${name}`, () => calls.kickPlayer({ player: name, reason })),
        kill: (name: string) => attempt(`kill ${name}`, () => calls.killPlayer({ player: name })),
        whitelistName,
        deleteOpenData,
    };
}

export type PlayersState = ReturnType<typeof createPlayers>;
