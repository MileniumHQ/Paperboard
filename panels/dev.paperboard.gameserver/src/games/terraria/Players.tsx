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
import type { BanEntry, SeenPlayer } from "./roster";

interface Player {
    name: string;
    lastSeen?: number;
    address?: string;
    banned: boolean;
}

const key = (name: string) => name.toLowerCase();

/** A Terraria player has no skin to fetch, so every game draws the same figure. */
export function TerrariaAvatar(props: { name: string; size: "small" | "medium" | "xlarge" }) {
    return <PaperAvatar size={props.size} shape="square" alt={props.name} fallbackIcon="person" />;
}

export default function TerrariaPlayers() {
    const [seen, setSeen] = createSignal<SeenPlayer[]>([]);
    const [bans, setBans] = createSignal<BanEntry[]>([]);
    const [feedback, setFeedback] = createSignal("");
    const [search, setSearch] = createSignal("");
    const [showOnline, setShowOnline] = createSignal(true);
    const [showBanned, setShowBanned] = createSignal(true);
    const [openName, setOpenName] = createSignal<string | undefined>();
    const [banOpen, setBanOpen] = createSignal(false);
    const [busy, setBusy] = createSignal(false);

    const online = createMemo(() => new Set([...onlinePlayerNames()].map(key)));
    const isOnline = (name: string) => online().has(key(name));

    const load = async () => {
        try {
            const roster = await serverBridge.call<{ seen: SeenPlayer[]; bans: BanEntry[] }>("terraria-players");
            setSeen(roster.seen);
            setBans(roster.bans);
        } catch (err) {
            setFeedback(errorMessage(err));
        }
    };
    // joins, leaves and kicks change the roster files; read them again after each
    createEffect(on(onlinePlayerNames, () => void load()));

    // everyone who has joined, who is online now, or who is banned by name
    const players = createMemo(() => {
        const byName = new Map<string, Player>();
        const banned = new Set(bans().map((ban) => key(ban.name)).filter(Boolean));
        for (const p of seen()) byName.set(key(p.name), { name: p.name, lastSeen: p.lastSeen, address: p.address, banned: banned.has(key(p.name)) });
        for (const name of onlinePlayerNames()) if (!byName.has(key(name))) byName.set(key(name), { name, banned: banned.has(key(name)) });
        for (const ban of bans()) if (ban.name && !byName.has(key(ban.name))) byName.set(key(ban.name), { name: ban.name, address: ban.address, banned: true });
        return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
    const visible = () => {
        const query = search().trim().toLowerCase();
        return players().filter((p) => {
            if (query && !p.name.toLowerCase().includes(query)) return false;
            if (isOnline(p.name) && showOnline()) return true;
            if (p.banned && showBanned()) return true;
            return !isOnline(p.name) && !p.banned;
        });
    };
    const open = () => players().find((p) => p.name === openName());

    const run = async (action: string, name: string) => {
        setBusy(true);
        setFeedback("");
        try {
            await serverBridge.call(action, { name });
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
                    { label: "Online", count: players().filter((p) => isOnline(p.name)).length, selected: showOnline(), onToggle: () => setShowOnline((v) => !v) },
                    { label: "Banned", count: players().filter((p) => p.banned).length, selected: showBanned(), onToggle: () => setShowBanned((v) => !v) },
                ]}
                feedback={feedback()}
                sections={[
                    { label: "Online", players: visible().filter((p) => isOnline(p.name)) },
                    { label: "Offline", players: visible().filter((p) => !isOnline(p.name)) },
                ]}
                icon={(player) => <TerrariaAvatar name={player.name} size="medium" />}
                description={(player) => (isOnline(player.name) ? "Playing" : lastSeenText(player.lastSeen))}
                badges={(player) => (
                    <Show when={player.banned}>
                        <PaperBadge variant="danger">Banned</PaperBadge>
                    </Show>
                )}
                status={(player) => statusColor(isOnline(player.name), player.banned)}
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
                                    description="Players appear here once they join. Pick one to see when they played and to kick or ban them."
                                />
                            </PaperFlex>
                        </PaperCard>
                    }
                >
                    {(player) => (
                        <PaperCard fullHeight scrollable>
                            <PaperFlex direction="column" gap="full" padding="full">
                                <PaperFlex direction="row" gap="full" align="center" wrap>
                                    <TerrariaAvatar name={player.name} size="xlarge" />
                                    <PaperFlex direction="column" gap="onefourth" grow minWidth={0}>
                                        <PaperText size={7} weight={700}>{player.name}</PaperText>
                                        <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                                            <PaperBadge variant={player.banned ? "danger" : isOnline(player.name) ? "success" : "monochrome"}>
                                                {player.banned ? "Banned" : isOnline(player.name) ? "Online" : "Offline"}
                                            </PaperBadge>
                                        </PaperFlex>
                                    </PaperFlex>
                                </PaperFlex>

                                <PaperSeparator />

                                <PaperFlex direction="row" gap="half" wrap>
                                    <PaperButton
                                        disabled={busy() || serverStatus() !== "online" || !isOnline(player.name)}
                                        onClick={() => void run("terraria-kick", player.name)}
                                    >
                                        Kick
                                    </PaperButton>
                                    <Show
                                        when={!player.banned}
                                        fallback={
                                            <PaperButton variant="primary" disabled={busy()} onClick={() => void run("terraria-unban", player.name)}>
                                                Unban
                                            </PaperButton>
                                        }
                                    >
                                        <PaperButton variant="danger" disabled={busy()} onClick={() => setBanOpen(true)}>
                                            <PaperIcon>block</PaperIcon>Ban
                                        </PaperButton>
                                    </Show>
                                </PaperFlex>

                                <PaperSeparator />

                                <PaperText size={2} weight={700} color="text-subtle">Details</PaperText>
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Last seen</th>
                                            <td>{isOnline(player.name) ? "Online now" : player.lastSeen ? new Date(player.lastSeen).toLocaleString() : "Not seen yet"}</td>
                                        </tr>
                                        <tr>
                                            <th>Address</th>
                                            <td>
                                                <Show when={player.address} fallback="Not seen yet">
                                                    {(address) => (
                                                        <PaperFlex direction="row" gap="half" align="center">
                                                            <PaperText family="code" size={2}>{address()}</PaperText>
                                                            <PaperCopyButton text={address()} />
                                                        </PaperFlex>
                                                    )}
                                                </Show>
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
                        <PaperButton onClick={() => setBanOpen(false)}>Cancel</PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={async () => {
                                const player = open();
                                if (player && (await run("terraria-ban", player.name))) setBanOpen(false);
                            }}
                        >
                            Ban
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    Terraria bans the address a player joins from, so anyone else joining from it is turned away too. An online player is removed at once.
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
