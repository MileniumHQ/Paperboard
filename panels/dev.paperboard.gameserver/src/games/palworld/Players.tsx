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
import type { PalworldSeen } from "./roster";
import type { PalworldPlayer } from "./rest";

interface Player {
    /** what the roster shows; Palworld names need not be unique, so a clash gets the user id */
    name: string;
    userId: string;
    level?: number;
    lastSeen?: number;
    ping?: number;
    online: boolean;
    banned: boolean;
}

function PalworldAvatar(props: { name: string; size: "medium" | "xlarge" }) {
    return <PaperAvatar size={props.size} shape="square" alt={props.name} fallbackIcon="person" />;
}

export default function PalworldPlayers() {
    const [seen, setSeen] = createSignal<PalworldSeen[]>([]);
    const [bans, setBans] = createSignal<string[]>([]);
    const [online, setOnline] = createSignal<PalworldPlayer[]>([]);
    const [feedback, setFeedback] = createSignal("");
    const [search, setSearch] = createSignal("");
    const [showOnline, setShowOnline] = createSignal(true);
    const [showBanned, setShowBanned] = createSignal(true);
    const [openName, setOpenName] = createSignal<string | undefined>();
    const [banOpen, setBanOpen] = createSignal(false);
    const [busy, setBusy] = createSignal(false);

    const load = async () => {
        try {
            const roster = await serverBridge.call<{ seen: PalworldSeen[]; bans: string[]; online: PalworldPlayer[] }>("palworld-players");
            setSeen(roster.seen);
            setBans(roster.bans);
            setOnline(roster.online);
        } catch (err) {
            setFeedback(errorMessage(err));
        }
    };
    // the service polls who is online; read the roster again when that changes
    createEffect(on(onlinePlayerNames, () => void load()));

    const players = createMemo(() => {
        const byId = new Map<string, Player>();
        const banned = new Set(bans());
        for (const p of seen()) byId.set(p.userId, { name: p.name, userId: p.userId, level: p.level, lastSeen: p.lastSeen, online: false, banned: banned.has(p.userId) });
        for (const p of online()) byId.set(p.userId, { name: p.name, userId: p.userId, level: p.level, ping: p.ping, lastSeen: Date.now(), online: true, banned: banned.has(p.userId) });
        for (const id of bans()) if (!byId.has(id)) byId.set(id, { name: id, userId: id, online: false, banned: true });
        const list = [...byId.values()];
        const counts = new Map<string, number>();
        for (const p of list) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
        return list
            .map((p) => ((counts.get(p.name) ?? 0) > 1 && p.name !== p.userId ? { ...p, name: `${p.name} (${p.userId})` } : p))
            .sort((a, b) => a.name.localeCompare(b.name));
    });
    const visible = () => {
        const query = search().trim().toLowerCase();
        return players().filter((p) => {
            if (query && !p.name.toLowerCase().includes(query) && !p.userId.toLowerCase().includes(query)) return false;
            if (p.online && showOnline()) return true;
            if (p.banned && showBanned()) return true;
            return !p.online && !p.banned;
        });
    };
    const open = () => players().find((p) => p.name === openName());

    const run = async (action: string, player: Player) => {
        setBusy(true);
        setFeedback("");
        try {
            await serverBridge.call(action, { userId: player.userId });
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
                icon={(player) => <PalworldAvatar name={player.name} size="medium" />}
                description={(player) => (player.online ? `Playing · level ${player.level ?? 0}` : lastSeenText(player.lastSeen))}
                badges={(player) => (
                    <Show when={player.banned}>
                        <PaperBadge variant="danger">Banned</PaperBadge>
                    </Show>
                )}
                status={(player) => statusColor(player.online, player.banned)}
                open={open()?.name}
                onOpen={setOpenName}
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
                                    description="Players appear here once they join. Pick one to see their level and to kick or ban them."
                                />
                            </PaperFlex>
                        </PaperCard>
                    }
                >
                    {(player) => (
                        <PaperCard fullHeight scrollable>
                            <PaperFlex direction="column" gap="full" padding="full">
                                <PaperFlex direction="row" gap="full" align="center" wrap>
                                    <PalworldAvatar name={player.name} size="xlarge" />
                                    <PaperFlex direction="column" gap="onefourth" grow minWidth={0}>
                                        <PaperText size={7} weight={700}>{player.name}</PaperText>
                                        <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                                            <PaperBadge variant={player.banned ? "danger" : player.online ? "success" : "monochrome"}>
                                                {player.banned ? "Banned" : player.online ? "Online" : "Offline"}
                                            </PaperBadge>
                                        </PaperFlex>
                                    </PaperFlex>
                                </PaperFlex>

                                <PaperSeparator />

                                <PaperFlex direction="row" gap="half" wrap>
                                    <PaperButton disabled={busy() || serverStatus() !== "online" || !player.online} onClick={() => void run("palworld-kick", player)}>
                                        Kick
                                    </PaperButton>
                                    <Show
                                        when={!player.banned}
                                        fallback={
                                            <PaperButton variant="primary" disabled={busy() || serverStatus() !== "online"} onClick={() => void run("palworld-unban", player)}>
                                                Unban
                                            </PaperButton>
                                        }
                                    >
                                        <PaperButton variant="danger" disabled={busy() || serverStatus() !== "online"} onClick={() => setBanOpen(true)}>
                                            <PaperIcon>block</PaperIcon>Ban
                                        </PaperButton>
                                    </Show>
                                </PaperFlex>
                                <Show when={serverStatus() !== "online"}>
                                    <PaperText size={2} color="text-subtle">Start the server to kick, ban or unban. Palworld keeps its own ban list.</PaperText>
                                </Show>

                                <PaperSeparator />

                                <PaperText size={2} weight={700} color="text-subtle">Details</PaperText>
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Last seen</th>
                                            <td>{player.online ? "Online now" : player.lastSeen ? new Date(player.lastSeen).toLocaleString() : "Not seen yet"}</td>
                                        </tr>
                                        <Show when={player.level !== undefined}>
                                            <tr>
                                                <th>Level</th>
                                                <td>{player.level}</td>
                                            </tr>
                                        </Show>
                                        <Show when={player.online && player.ping !== undefined}>
                                            <tr>
                                                <th>Ping</th>
                                                <td>{Math.round(player.ping!)} ms</td>
                                            </tr>
                                        </Show>
                                        <tr>
                                            <th>User id</th>
                                            <td>
                                                <PaperFlex direction="row" gap="half" align="center">
                                                    <PaperText family="code" size={2}>{player.userId}</PaperText>
                                                    <PaperCopyButton text={player.userId} />
                                                </PaperFlex>
                                            </td>
                                        </tr>
                                    </tbody>
                                </PaperTable>
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
                            disabled={busy() || serverStatus() !== "online"}
                            onClick={async () => {
                                const player = open();
                                if (player && (await run("palworld-ban", player))) setBanOpen(false);
                            }}
                        >
                            Ban
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    Palworld bans the player's account, wherever they join from. An online player is removed at once.
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
