import { createEffect, createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSectionHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import {
    backupApi,
    ROUTINE_BACKUP_HOURS,
    ROUTINE_BACKUP_LABEL,
    type BackupRecord,
    type BackupSchedule,
    type BackupStatus,
} from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/contract";

// Backups of the whole server folder (worlds, settings, plugins, mods),
// made now or routinely by this computer's Paperboard Server, which makes
// them whether Paperboard is open or not. A running server keeps running:
// it writes its world out and pauses saving while the folder is copied.

const DEFAULT_SCHEDULE = { everyHours: 24, keep: 7 } as const;
const KEEP_CHOICES = [1, 2, 3, 5, 7, 10, 14, 30];

const everyText = (hours: number) =>
    hours === 1 ? "Every hour"
    : hours === 24 ? "Every day"
    : hours === 168 ? "Every week"
    : hours % 24 === 0 ? `Every ${hours / 24} days`
    : `Every ${hours} hours`;

function sizeText(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const dateText = (iso: string) => new Date(iso).toLocaleString();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function Backups(props: { active: boolean }) {
    const [status, setStatus] = createSignal<BackupStatus | null>(null);
    const [backups, setBackups] = createSignal<BackupRecord[] | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [error, setError] = createSignal("");
    const [notice, setNotice] = createSignal("");
    const [busy, setBusy] = createSignal<"create" | "schedule" | null>(null);

    const load = async () => {
        setLoadError("");
        try {
            const now = await backupApi.status(PANEL_ID);
            setStatus(now);
            setBackups(now.location ? await backupApi.list(PANEL_ID) : []);
        } catch (err) {
            setLoadError(`Backups could not be loaded: ${message(err)}`);
        }
    };

    // looked up again each time the tab is shown: routine backups happen
    // while it is not
    createEffect(() => {
        if (props.active) void load();
    });

    const act = async (kind: "create" | "schedule", work: () => Promise<string | null>) => {
        if (busy()) return;
        setBusy(kind);
        setError("");
        setNotice("");
        try {
            const done = await work();
            if (done) setNotice(done);
        } catch (err) {
            setError(message(err));
        } finally {
            setBusy(null);
            await load();
        }
    };

    // a backup needs somewhere to go; the first one asks where
    const ensureLocation = async (): Promise<boolean> => {
        if (status()?.location) return true;
        return (await backupApi.chooseLocation(PANEL_ID)).status === "chosen";
    };

    const changeLocation = () => act("schedule", async () => {
        const result = await backupApi.chooseLocation(PANEL_ID);
        return result.status === "chosen" ? `Backups now go to ${result.location.label}.` : null;
    });

    const backUpNow = () => act("create", async () => {
        if (!(await ensureLocation())) return null;
        const record = await backupApi.create(PANEL_ID);
        return `Backed up the server (${sizeText(record.size)}).`;
    });

    const setSchedule = (next: { everyHours: BackupSchedule["everyHours"]; keep: number } | null) => act("schedule", async () => {
        if (next && !(await ensureLocation())) return null;
        await backupApi.setSchedule(PANEL_ID, next);
        return null;
    });

    const schedule = () => status()?.schedule ?? null;
    const keepChoices = () => {
        const current = schedule()?.keep;
        return current && !KEEP_CHOICES.includes(current) ? [...KEEP_CHOICES, current].sort((a, b) => a - b) : KEEP_CHOICES;
    };

    // Restore and Delete confirm in windows that stay mounted, so
    // PaperModal plays its own open and close.
    const [confirming, setConfirming] = createSignal<{ kind: "restore" | "delete"; record: BackupRecord } | null>(null);
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const [confirmBusy, setConfirmBusy] = createSignal(false);
    const [confirmError, setConfirmError] = createSignal("");

    const ask = (kind: "restore" | "delete", record: BackupRecord) => {
        setConfirming({ kind, record });
        setConfirmError("");
        setConfirmOpen(true);
    };

    const confirm = async () => {
        const target = confirming();
        if (!target || confirmBusy()) return;
        setConfirmBusy(true);
        setConfirmError("");
        try {
            if (target.kind === "restore") await backupApi.restore(PANEL_ID, target.record.id);
            else await backupApi.delete(PANEL_ID, target.record.id);
        } catch (err) {
            setConfirmError(`${target.kind === "restore" ? "The backup was not restored" : "The backup was not deleted"}: ${message(err)}`);
            return;
        } finally {
            setConfirmBusy(false);
        }
        setConfirmOpen(false);
        setError("");
        setNotice(target.kind === "restore" ? `Restored the backup from ${dateText(target.record.createdAt)}.` : "Deleted the backup.");
        await load();
    };

    const recordTitle = (record: BackupRecord) => record.label === ROUTINE_BACKUP_LABEL || !record.label ? dateText(record.createdAt) : record.label;
    const recordDetail = (record: BackupRecord) =>
        [record.label === ROUTINE_BACKUP_LABEL ? "Routine" : record.label ? dateText(record.createdAt) : "Made by hand", sizeText(record.size)].join(" · ");

    return (
        <>
            <PaperPageHeader icon="backup" title="Backups">
                <PaperButton disabled={busy() !== null || status() === null} onClick={() => void backUpNow()}>
                    <PaperIcon>{busy() === "create" ? "progress_activity" : "backup"}</PaperIcon>
                    {busy() === "create" ? "Backing up..." : "Back Up Now"}
                </PaperButton>
            </PaperPageHeader>

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Backups unavailable">
                    <PaperFlex direction="column" gap="half">
                        <PaperText>{loadError()}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Error">{error()}</PaperQuote>
            </Show>
            <Show when={notice()}>
                <PaperQuote variant="success" icon="check" title="Done">{notice()}</PaperQuote>
            </Show>

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Kept in"
                    description={status()?.location ? `${status()!.location!.label}: ${status()!.location!.detail}` : "Choose where this server's backups go."}
                >
                    <PaperButton size="small" disabled={busy() !== null || status() === null} onClick={() => void changeLocation()}>
                        {status()?.location ? "Change" : "Choose"}
                    </PaperButton>
                </PaperSettingItem>
                <PaperSettingItem
                    title="Routine Backups"
                    description="Backs up the server on a schedule, even with Paperboard closed. A running server pauses saving during the copy."
                >
                    <PaperToggle
                        checked={schedule() !== null}
                        disabled={busy() !== null || status() === null}
                        onChange={(on) => void setSchedule(on ? { ...DEFAULT_SCHEDULE } : null)}
                    />
                </PaperSettingItem>
                <Show when={schedule()}>
                    {(current) => (
                        <>
                            <PaperSettingItem title="How Often">
                                <PaperSelectMenu
                                    name="backupEvery"
                                    value={String(current().everyHours)}
                                    disabled={busy() !== null}
                                    onValueChange={(value) => void setSchedule({ everyHours: Number(value) as BackupSchedule["everyHours"], keep: current().keep })}
                                >
                                    <For each={[...ROUTINE_BACKUP_HOURS]}>
                                        {(hours) => <PaperSelectMenuItem value={String(hours)}>{everyText(hours)}</PaperSelectMenuItem>}
                                    </For>
                                </PaperSelectMenu>
                            </PaperSettingItem>
                            <PaperSettingItem title="Keep" description="Older routine backups are deleted. Backups made with Back Up Now are kept.">
                                <PaperSelectMenu
                                    name="backupKeep"
                                    value={String(current().keep)}
                                    disabled={busy() !== null}
                                    onValueChange={(value) => void setSchedule({ everyHours: current().everyHours, keep: Number(value) })}
                                >
                                    <For each={keepChoices()}>
                                        {(keep) => <PaperSelectMenuItem value={String(keep)}>{keep === 1 ? "The newest" : `The newest ${keep}`}</PaperSelectMenuItem>}
                                    </For>
                                </PaperSelectMenu>
                            </PaperSettingItem>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <PaperText size={2} color="text-subtle">Next routine backup: {dateText(current().nextRunAt)}</PaperText>
                                <Show when={current().last}>
                                    {(last) => (
                                        <PaperText size={2} color={last().ok ? "text-subtle" : "danger"}>
                                            {last().ok
                                                ? `Last routine backup: ${dateText(last().at)}`
                                                : `The routine backup at ${dateText(last().at)} failed: ${last().message ?? "no reason given"}`}
                                        </PaperText>
                                    )}
                                </Show>
                            </PaperFlex>
                        </>
                    )}
                </Show>
            </PaperSettingList>

            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperSectionHeader icon="history" title="Saved Backups" count={backups()?.length || undefined} />
                <Show when={backups()} fallback={<Show when={!loadError()}><PaperText size={2} color="text-subtle">Loading backups…</PaperText></Show>}>
                    {(list) => (
                        <Show
                            when={list().length > 0}
                            fallback={
                                <PaperText size={2} color="text-subtle">
                                    {status()?.location ? "No backups here yet." : "Choose where backups go, then back up the server."}
                                </PaperText>
                            }
                        >
                            <PaperSettingList autoHeight>
                                <For each={list()}>
                                    {(record) => (
                                        <PaperSettingItem title={recordTitle(record)} description={recordDetail(record)}>
                                            <PaperFlex direction="row" gap="half">
                                                <PaperButton size="small" disabled={busy() !== null} onClick={() => ask("restore", record)}>Restore</PaperButton>
                                                <PaperButton size="small" icon variant="text" title="Delete backup" aria-label="Delete backup"
                                                    disabled={busy() !== null} onClick={() => ask("delete", record)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </PaperFlex>
                                        </PaperSettingItem>
                                    )}
                                </For>
                            </PaperSettingList>
                        </Show>
                    )}
                </Show>
            </PaperFlex>

            <PaperModal
                open={confirmOpen()}
                title={confirming()?.kind === "delete" ? "Delete this backup?" : "Restore this backup?"}
                size="small"
                onClose={() => { if (!confirmBusy()) setConfirmOpen(false); }}
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton variant="text" disabled={confirmBusy()} onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={confirmBusy()} onClick={() => void confirm()}>
                            {confirmBusy()
                                ? confirming()?.kind === "delete" ? "Deleting..." : "Restoring..."
                                : confirming()?.kind === "delete" ? "Delete" : "Restore"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        {confirming()?.kind === "delete"
                            ? `The backup from ${confirming() ? dateText(confirming()!.record.createdAt) : ""} is deleted from ${status()?.location?.label ?? "its location"}.`
                            : `The server stops, and its whole folder (worlds, settings, plugins and mods) is replaced with the backup from ${confirming() ? dateText(confirming()!.record.createdAt) : ""}. Anything since then is lost. Start the server again afterwards.`}
                    </PaperText>
                    <Show when={confirmError()}>
                        <PaperText size={2} color="danger">{confirmError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
