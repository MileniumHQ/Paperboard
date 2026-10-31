import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCopyButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperSeparator,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import PlayerRoster, { statusColor } from "../../components/PlayerRoster";
import { onlinePlayerNames, serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceActions, type SourceGameSpec } from "./index";
import type { SourceBan, SourceSeen } from "./roster";
import type { SourceOnline } from "./service";

interface Player {
    /** what the roster shows; a clash between names gets the Steam id */
    name: string;
    key: string;
    steamId: string;
    bot: boolean;
    userId?: number;
    /** "Red", "Blue", "Spectator"; empty before they pick one */
    team?: string;
    since?: number;
    lastSeen?: number;
    online: boolean;
    banned: boolean;
}

function SourceAvatar(props: { name: string; bot: boolean; size: "medium" | "xlarge" }) {
    return <PaperAvatar size={props.size} shape="square" alt={props.name} fallbackIcon={props.bot ? "smart_toy" : "person"} />;
}

export default function SourcePlayers(props: { spec: SourceGameSpec }) {
    const ids = sourceActions(props.spec.id);
    const [seen, setSeen] = createSignal<SourceSeen[]>([]);
    const [bans, setBans] = createSignal<SourceBan[]>([]);
    const [online, setOnline] = createSignal<SourceOnline[]>([]);
    const [feedback, setFeedback] = createSignal("");
    const [search, setSearch] = createSignal("");
    const [showOnline, setShowOnline] = createSignal(true);
    const [showBanned, setShowBanned] = createSignal(true);
    const [openKey, setOpenKey] = createSignal<string | undefined>();
    const [banOpen, setBanOpen] = createSignal(false);
    const [busy, setBusy] = createSignal(false);

    const load = async () => {
        try {
            const roster = await serverBridge.call<{ seen: SourceSeen[]; bans: SourceBan[]; online: SourceOnline[] }>(ids.players);
            setSeen(roster.seen);
            setBans(roster.bans);
            setOnline(roster.online);
        } catch (err) {
            setFeedback(errorMessage(err));
        }
    };
    // joins and leaves change who is online; read the roster again then
    createEffect(on([onlinePlayerNames, serverStatus], () => void load()));

    const players = createMemo(() => {
        const byKey = new Map<string, Player>();
        const banned = new Set(bans().map((b) => b.steamId));
        for (const p of seen()) byKey.set(p.steamId, { name: p.name, key: p.steamId, steamId: p.steamId, bot: false, lastSeen: p.lastSeen, online: false, banned: banned.has(p.steamId) });
        for (const p of online()) {
            const bot = p.steamId === "BOT";
            const key = bot ? `bot-${p.userId}` : p.steamId;
            byKey.set(key, { name: p.name, key, steamId: p.steamId, bot, userId: p.userId, team: p.team && p.team !== "Unassigned" ? p.team : undefined, since: p.since, lastSeen: Date.now(), online: true, banned: banned.has(p.steamId) });
        }
        for (const b of bans()) if (!byKey.has(b.steamId)) byKey.set(b.steamId, { name: b.name, key: b.steamId, steamId: b.steamId, bot: false, online: false, banned: true });
        const list = [...byKey.values()];
        const counts = new Map<string, number>();
        for (const p of list) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
        return list
            .map((p) => ((counts.get(p.name) ?? 0) > 1 && !p.bot && p.name !== p.steamId ? { ...p, name: `${p.name} (${p.steamId})` } : p))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
    const visible = () => {
        const query = search().trim().toLowerCase();
        return players().filter((p) => {
            if (query && !p.name.toLowerCase().includes(query) && !p.steamId.toLowerCase().includes(query)) return false;
            if (p.online && showOnline()) return true;
            if (p.banned && showBanned()) return true;
            return !p.online && !p.banned;
        });
    };
    const open = () => players().find((p) => p.key === openKey());

    const run = async (action: string, input: Record<string, unknown>) => {
        setBusy(true);
        setFeedback("");
        try {
            await serverBridge.call(action, input);
            await load();
            return true;
        } catch (err) {
            setFeedback(errorMessage(err));
            return false;
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="group" title="Players" />
            <PlayerRoster
                search={search()}
                onSearch={setSearch}
                filters={[
                    { label: "Online", count: players().filter((p) => p.online).length, selected: showOnline(), onToggle: () => setShowOnline((v) => !v) },
                    { label: "Banned", count: players().filter((p) => p.banned).length, selected: showBanned(), onToggle: () => setShowBanned((v) => !v) },
                ]}
                feedback={feedback()}
                sections={[
                    { label: "Online", players: visible().filter((p) => p.online) },
                    { label: "Offline", players: visible().filter((p) => !p.online) },
                ]}
                icon={(player) => <SourceAvatar name={player.name} bot={player.bot} size="medium" />}
                description={(player) => (player.online ? [player.team, player.bot ? "Bot" : `Playing for ${duration(player.since)}`].filter(Boolean).join(" · ") : lastSeenText(player.lastSeen))}
                badges={(player) => (
                    <Show when={player.banned}>
                        <PaperBadge variant="danger">Banned</PaperBadge>
                    </Show>
                )}
                status={(player) => statusColor(player.online, player.banned)}
                open={open()?.name}
                onOpen={(name) => setOpenKey(players().find((p) => p.name === name)?.key)}
            >
                <Show
                    when={open()}
                    keyed
                    fallback={
                        <PaperCard fullHeight>
                            <PaperFlex fullHeight fullWidth center padding="full">
                                <PaperEmptyState
                                    icon="group"
                                    title="Select a player"
                                    description="Players appear here once they join. Pick one to kick or ban them."
                                />
                            </PaperFlex>
                        </PaperCard>
                    }
                >
                    {(player) => (
                        <PaperCard fullHeight scrollable>
                            <PaperFlex direction="column" gap="full" padding="full">
                                <PaperFlex direction="row" gap="full" align="center" wrap>
                                    <SourceAvatar name={player.name} bot={player.bot} size="xlarge" />
                                    <PaperFlex direction="column" gap="onefourth" grow minWidth={0}>
                                        <PaperText size={7} weight={700}>{player.name}</PaperText>
                                        <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                                            <PaperBadge variant={player.banned ? "danger" : player.online ? "success" : "monochrome"}>
                                                {player.banned ? "Banned" : player.online ? "Online" : "Offline"}
                                            </PaperBadge>
                                            <Show when={player.team}>
                                                <PaperBadge>{player.team}</PaperBadge>
                                            </Show>
                                            <Show when={player.bot}>
                                                <PaperBadge>Bot</PaperBadge>
                                            </Show>
                                        </PaperFlex>
                                    </PaperFlex>
                                </PaperFlex>

                                <PaperSeparator />

                                <PaperFlex direction="row" gap="half" wrap>
                                    <PaperButton disabled={busy() || serverStatus() !== "online" || !player.online} onClick={() => void run(ids.kick, { userId: player.userId })}>
                                        Kick
                                    </PaperButton>
                                    <Show when={!player.bot}>
                                        <Show
                                            when={!player.banned}
                                            fallback={
                                                <PaperButton variant="primary" disabled={busy()} onClick={() => void run(ids.unban, { steamId: player.steamId })}>
                                                    Unban
                                                </PaperButton>
                                            }
                                        >
                                            <PaperButton variant="danger" disabled={busy()} onClick={() => setBanOpen(true)}>
                                                <PaperIcon>block</PaperIcon>Ban
                                            </PaperButton>
                                        </Show>
                                    </Show>
                                </PaperFlex>

                                <Show when={!player.bot}>
                                    <PaperSeparator />

                                    <PaperText size={2} weight={700} color="text-subtle">Details</PaperText>
                                    <PaperTable>
                                        <tbody>
                                            <tr>
                                                <th>Last seen</th>
                                                <td>{player.online ? "Online now" : player.lastSeen ? new Date(player.lastSeen).toLocaleString() : "Not seen yet"}</td>
                                            </tr>
                                            <tr>
                                                <th>Steam id</th>
                                                <td>
                                                    <PaperFlex direction="row" gap="half" align="center">
                                                        <PaperText family="code" size={2}>{player.steamId}</PaperText>
                                                        <PaperCopyButton text={player.steamId} />
                                                    </PaperFlex>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </PaperTable>
                                </Show>
                            </PaperFlex>
                        </PaperCard>
                    )}
                </Show>
            </PlayerRoster>

            <PaperModal
                open={banOpen()}
                onClose={() => setBanOpen(false)}
                title={`Ban ${open()?.name ?? "player"}`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setBanOpen(false)}>Cancel</PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={async () => {
                                const player = open();
                                if (player && (await run(ids.ban, { steamId: player.steamId }))) setBanOpen(false);
                            }}
                        >
                            Ban
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    The ban is on their Steam account, wherever they join from. An online player is removed at once.
                </PaperText>
                <Show when={feedback()}>
                    <PaperText size={2} color="danger">{feedback()}</PaperText>
                </Show>
            </PaperModal>
        </>
    );
}

function lastSeenText(at: number | undefined): string {
    return at ? `Last seen ${new Date(at).toLocaleString()}` : "Not seen yet";
}
function duration(since: number | undefined): string {
    const minutes = since ? Math.max(0, Math.floor((Date.now() - since) / 60_000)) : 0;
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
