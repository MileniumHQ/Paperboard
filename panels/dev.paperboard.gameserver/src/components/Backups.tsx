import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
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
    backupProgressText,
    ROUTINE_BACKUP_HOURS,
    ROUTINE_BACKUP_LABEL,
    type BackupProgress,
    type BackupRecord,
    type BackupSchedule,
    type BackupStatus,
} from "../lib/api";
import { selectedServerId } from "../lib/api";
import { PANEL_ID } from "../service/contract";
import { errorMessage, type Outcome } from "../lib/failure";
import { createSaves } from "../lib/saves";

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

export default function Backups(props: { active: boolean; whileRunning: "quiesce" | "offline" }) {
    if (!selectedServerId) throw new Error("Choose a server before opening backups");
    const backupsApi = backupApi.forSource(PANEL_ID, selectedServerId);
    const [status, setStatus] = createSignal<BackupStatus | null>(null);
    const [backups, setBackups] = createSignal<BackupRecord[] | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [error, setError] = createSignal<Outcome | null>(null);
    const [notice, setNotice] = createSignal<Outcome | null>(null);
    const [busy, setBusy] = createSignal<"create" | "location" | null>(null);
    // the server's running backup or restore, made here or routinely
    const [progress, setProgress] = createSignal<BackupProgress | null>(null);
    let stopProgress: (() => void) | null = null;
    onCleanup(() => stopProgress?.());

    const load = async () => {
        setLoadError("");
        try {
            stopProgress ??= backupsApi.onProgress((change) => setProgress(change.progress));
            const now = await backupsApi.status();
            setStatus(now);
            setProgress(now.progress);
            setBackups(now.location ? await backupsApi.list() : []);
        } catch (err) {
            setLoadError(`Backups could not be loaded: ${errorMessage(err)}`);
        }
    };

    // looked up again each time the tab is shown: routine backups happen
    // while it is not
    createEffect(() => {
        if (props.active) void load();
    });

    // the routine schedule is one setting, its switch and both menus change
    // it; a backup made now and a new location take their turn with its
    // saves, so two location pickers never open at once
    const saves = createSaves({
        failed: (err) => setError({ title: "Schedule not saved", message: errorMessage(err) }),
        changed: () => {
            setError(null);
            setNotice(null);
        },
    });

    const act = async (kind: "create" | "location", failTitle: string, work: () => Promise<Outcome | null>) => {
        if (busy()) return;
        setBusy(kind);
        setError(null);
        setNotice(null);
        try {
            const done = await saves.run(work);
            if (done) setNotice(done);
        } catch (err) {
            setError({ title: failTitle, message: errorMessage(err) });
        } finally {
            // what the work changed is on screen before its button is back
            await load();
            setBusy(null);
        }
    };

    // a backup needs somewhere to go; the first one asks where
    const ensureLocation = async (): Promise<boolean> => {
        if (status()?.location) return true;
        return (await backupsApi.chooseLocation()).status === "chosen";
    };

    const changeLocation = () => act("location", "Location not changed", async () => {
        const result = await backupsApi.chooseLocation();
        return result.status === "chosen"
            ? { title: "Location changed", message: `Backups now go to ${result.location.label}.` }
            : null;
    });

    const backUpNow = () => act("create", "Backup failed", async () => {
        if (!(await ensureLocation())) return null;
        const record = await backupsApi.create();
        return { title: "Backed up", message: `Backed up the server (${sizeText(record.size)}).` };
    });

    const schedule = () => status()?.schedule ?? null;
    const routine = saves.setting<{ everyHours: BackupSchedule["everyHours"]; keep: number } | null>(
        "schedule",
        () => {
            const stored = schedule();
            return stored ? { everyHours: stored.everyHours, keep: stored.keep } : null;
        },
        async (next) => {
            // a first routine backup needs somewhere to go; closing the picker calls it off
            if (next && !(await ensureLocation())) return false;
            setStatus(await backupsApi.setSchedule(next));
        },
    );
    const keepChoices = () => {
        const current = routine.value()?.keep;
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
            if (target.kind === "restore") await backupsApi.restore(target.record.id);
            else await backupsApi.delete(target.record.id);
        } catch (err) {
            setConfirmError(`${target.kind === "restore" ? "The backup was not restored" : "The backup was not deleted"}: ${errorMessage(err)}`);
            return;
        } finally {
            setConfirmBusy(false);
        }
        setConfirmOpen(false);
        setError(null);
        setNotice(
            target.kind === "restore"
                ? { title: "Restored", message: `Restored the backup from ${dateText(target.record.createdAt)}.` }
                : { title: "Deleted", message: "Deleted the backup." },
        );
        await load();
    };

    const recordTitle = (record: BackupRecord) => record.label === ROUTINE_BACKUP_LABEL || !record.label ? dateText(record.createdAt) : record.label;
    const recordDetail = (record: BackupRecord) =>
        [record.label === ROUTINE_BACKUP_LABEL ? "Routine" : record.label ? dateText(record.createdAt) : "Made by hand", sizeText(record.size)].join(" · ");

    return (
        <>
            <PaperPageHeader icon="backup" title="Backups">
                <PaperButton disabled={busy() !== null || progress() !== null || status() === null} onClick={() => void backUpNow()}>
                    <PaperIcon>{busy() === "create" || progress() ? "progress_activity" : "backup"}</PaperIcon>
                    {progress() ? backupProgressText(progress()!) : busy() === "create" ? "Backing up..." : "Back Up Now"}
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
                {(failure) => (
                    <PaperQuote variant="danger" icon="warning" title={failure().title}>{failure().message}</PaperQuote>
                )}
            </Show>
            <Show when={notice()}>
                {(done) => (
                    <PaperQuote variant="success" icon="check" title={done().title}>{done().message}</PaperQuote>
                )}
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
                    description={`Backs up the server on a schedule, even with Paperboard closed. ${props.whileRunning === "quiesce"
                        ? "A running server keeps going; saving pauses during the copy."
                        : "A running server is saved, stopped for the copy and started again."}`}
                >
                    <PaperToggle
                        checked={routine.value() !== null}
                        disabled={status() === null}
                        onChange={(on) => routine.set(on ? { ...DEFAULT_SCHEDULE } : null)}
                    />
                </PaperSettingItem>
                <Show when={routine.value()}>
                    {(current) => (
                        <>
                            <PaperSettingItem title="How Often">
                                <PaperSelectMenu
                                    name="backupEvery"
                                    value={String(current().everyHours)}
                                    onValueChange={(value) => routine.set({ everyHours: Number(value) as BackupSchedule["everyHours"], keep: current().keep })}
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
                                    onValueChange={(value) => routine.set({ everyHours: current().everyHours, keep: Number(value) })}
                                >
                                    <For each={keepChoices()}>
                                        {(keep) => <PaperSelectMenuItem value={String(keep)}>{keep === 1 ? "The newest" : `The newest ${keep}`}</PaperSelectMenuItem>}
                                    </For>
                                </PaperSelectMenu>
                            </PaperSettingItem>
                        </>
                    )}
                </Show>
                <Show when={schedule()}>
                    {(stored) => (
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={2} color="text-subtle">Next routine backup: {dateText(stored().nextRunAt)}</PaperText>
                            <Show when={stored().last}>
                                {(last) => (
                                    <PaperText size={2} color={last().ok ? "text-subtle" : "danger"}>
                                        {last().ok
                                            ? `Last routine backup: ${dateText(last().at)}`
                                            : `The routine backup at ${dateText(last().at)} failed: ${last().message ?? "no reason given"}`}
                                    </PaperText>
                                )}
                            </Show>
                        </PaperFlex>
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
                    <>
                        <PaperButton variant="text" disabled={confirmBusy()} onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={confirmBusy()} onClick={() => void confirm()}>
                            {confirmBusy()
                                ? confirming()?.kind === "delete" ? "Deleting..." : "Restoring..."
                                : confirming()?.kind === "delete" ? "Delete" : "Restore"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        {confirming()?.kind === "delete"
                            ? `The backup from ${confirming() ? dateText(confirming()!.record.createdAt) : ""} is deleted from ${status()?.location?.label ?? "its location"}.`
                            : `The server stops, and its whole folder (worlds, settings, plugins and mods) is replaced with the backup from ${confirming() ? dateText(confirming()!.record.createdAt) : ""}. Anything since then is lost. Offline-only games restart if they were running; otherwise start the server afterwards.`}
                    </PaperText>
                    <Show when={confirmError()}>
                        <PaperText size={2} color="danger">{confirmError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
