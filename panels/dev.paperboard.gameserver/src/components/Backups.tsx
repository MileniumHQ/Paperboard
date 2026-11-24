import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperError,
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
    createRead,
    showError,
} from "@mileniumhq/paperui";
import { backupApi, backupProgressText, type BackupRecord } from "../lib/api";
import { ROUTINE_BACKUP_HOURS, ROUTINE_BACKUP_LABEL, type BackupScheduleChoice } from "../backupSchedule";
import { useServer } from "../lib/server";
import { PANEL_ID } from "../service/contract";
import { errorMessage, type Outcome } from "../lib/failure";
import { createSaves } from "../lib/saves";

// Backups of the whole server folder (worlds, settings, plugins, mods),
// made now or routinely by the panel's service on this computer's Paperboard
// Server, whether Paperboard is open or not. A running server keeps running
// with its saving paused while the folder is copied, or, for a game that
// can't be copied while it runs, is saved, stopped and started again.

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
    const server = useServer();
    const ofServer = { target: server.id };
    // looked up again each time the tab is shown: routine backups happen
    // while it is not. Each read keeps the rows it did not change, so a
    // reload rebuilds no backup's row; the server's running backup or
    // restore, made here, by a block or routinely, arrives as it moves, and
    // once it ends its backup and the schedule's last result are read
    // why the running backup's progress can't be heard; once it can again, what it missed is read again
    const [lost, setLost] = createSignal<string | null>(null);
    const read = createRead(
        async () => {
            const [status, schedule] = await Promise.all([backupApi.status(PANEL_ID, ofServer), server.calls.readBackupSchedule()]);
            return { status, schedule, backups: status.location ? await backupApi.list(PANEL_ID, ofServer) : [] };
        },
        {
            source: () => props.active,
            follow: (land) =>
                backupApi.onProgress(
                    PANEL_ID,
                    (change) => {
                        // another server's backup is that server's
                        if (change.target !== server.id) return;
                        land((prev) => prev && { ...prev, status: { ...prev.status, progress: change.progress } });
                        if (change.progress === null) void read.reload();
                    },
                    {
                        onLost: (why) => {
                            setLost(why);
                            if (why === null) void read.reload();
                        },
                    },
                ),
            message: errorMessage,
        },
    );
    const status = () => read.value()?.status ?? null;
    const backups = () => read.value()?.backups ?? null;
    const progress = () => status()?.progress ?? null;
    const load = read.reload;
    const [notice, setNotice] = createSignal<Outcome | null>(null);
    const [busy, setBusy] = createSignal<"create" | "location" | null>(null);

    // the routine schedule is one setting, its switch and both menus change
    // it; a backup made now and a new location take their turn with its
    // saves, so two location pickers never open at once
    const saves = createSaves({
        failed: (err) => showError("Couldn't save the backup schedule", errorMessage(err)),
        changed: () => setNotice(null),
    });

    const act = async (kind: "create" | "location", failTitle: string, work: () => Promise<Outcome | null>) => {
        if (busy()) return;
        setBusy(kind);
        setNotice(null);
        try {
            const done = await saves.run(work);
            if (done) setNotice(done);
        } catch (err) {
            showError(failTitle, errorMessage(err));
        } finally {
            // what the work changed is on screen before its button is back
            await load();
            setBusy(null);
        }
    };

    // a backup needs somewhere to go; the first one asks where
    const ensureLocation = async (): Promise<boolean> => {
        if (status()?.location) return true;
        return (await backupApi.chooseLocation(PANEL_ID)).status === "chosen";
    };

    const changeLocation = () => act("location", "Couldn't change the location", async () => {
        const result = await backupApi.chooseLocation(PANEL_ID);
        return result.status === "chosen"
            ? { title: "Location changed", message: `Game Server's backups now go to ${result.location.label}.` }
            : null;
    });

    // "Backing up" once a backup runs: a first one waits on the location picker before it
    const backUpNow = () => act(status()?.location ? "create" : "location", "Couldn't back up the server", async () => {
        if (!(await ensureLocation())) return null;
        setBusy("create");
        const record = await server.calls.backUp({});
        return { title: "Backed up", message: `Backed up the server (${sizeText(record.size)}).` };
    });

    const schedule = () => read.value()?.schedule ?? null;
    const routine = saves.setting<BackupScheduleChoice | null>(
        "schedule",
        () => {
            const stored = schedule();
            return stored ? { everyHours: stored.everyHours, keep: stored.keep } : null;
        },
        async (next) => {
            // a first routine backup needs somewhere to go; closing the picker calls it off
            if (next && !(await ensureLocation())) return false;
            const saved = await server.calls.writeBackupSchedule({ schedule: next });
            read.set((prev) => prev && { ...prev, schedule: saved });
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

    const ask = (kind: "restore" | "delete", record: BackupRecord) => {
        setConfirming({ kind, record });
        setConfirmOpen(true);
    };

    const confirm = async () => {
        const asked = confirming();
        if (!asked || confirmBusy()) return;
        setConfirmBusy(true);
        // a refusal is a toast over the dialog, which stays open
        let done = false;
        try {
            if (asked.kind === "restore") await server.calls.restoreBackup({ backupId: asked.record.id });
            else await backupApi.delete(PANEL_ID, asked.record.id, ofServer);
            done = true;
        } catch (err) {
            showError(asked.kind === "restore" ? "Couldn't restore the backup" : "Couldn't delete the backup", errorMessage(err));
        } finally {
            setConfirmBusy(false);
        }
        if (!done) return;
        setConfirmOpen(false);
        setNotice(
            asked.kind === "restore"
                ? { title: "Restored", message: `Restored the backup from ${dateText(asked.record.createdAt)}.` }
                : { title: "Deleted", message: "Deleted the backup." },
        );
        await load();
    };

    /** a backup named in a sentence: its label, or when it was made */
    const backupName = (record: BackupRecord) =>
        record.label === ROUTINE_BACKUP_LABEL || !record.label ? `the backup from ${dateText(record.createdAt)}` : `“${record.label}”`;
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

            {/* it hears the progress again by itself, and reads what it missed */}
            <Show when={lost()}>
                {(why) => <PaperError title="Couldn't follow the backup's progress" error={why()} />}
            </Show>

            <Show when={notice()}>
                {(done) => (
                    <PaperQuote variant="success" icon="check" title={done().title}>{done().message}</PaperQuote>
                )}
            </Show>

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Kept in"
                    description={status()?.location ? `${status()!.location!.label}: ${status()!.location!.detail}` : "Choose where backups go. Every server's go to the same place."}
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
                                    onValueChange={(value) => routine.set({ everyHours: Number(value) as BackupScheduleChoice["everyHours"], keep: current().keep })}
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
                {/* above the backups read before, which stay on screen */}
                <Show when={read.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't load the backups"
                            error={err()}
                            action={{ label: "Try again", disabled: read.loading(), onClick: () => void load() }}
                        />
                    )}
                </Show>
                <Show
                    when={backups()}
                    fallback={
                        <Show when={read.error() === null}>
                            <PaperFlex paddingX="full"><PaperText size={2} color="text-subtle">Loading backups…</PaperText></PaperFlex>
                        </Show>
                    }
                >
                    {(list) => (
                        <Show
                            when={list().length > 0}
                            fallback={
                                // under the header's title, which sits in from the card edge by a gap
                                <PaperFlex paddingX="full">
                                    <PaperText size={2} color="text-subtle">
                                        {status()?.location ? "No backups here yet." : "Choose where backups go, then back up the server."}
                                    </PaperText>
                                </PaperFlex>
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
                title={confirming() ? `${confirming()!.kind === "delete" ? "Delete" : "Restore"} ${backupName(confirming()!.record)}?` : ""}
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
                            ? `It is deleted from ${status()?.location?.label ?? "its location"}.`
                            : `The server stops, and its whole folder (worlds, settings, plugins and mods) is replaced with this backup${confirming() ? `, made ${dateText(confirming()!.record.createdAt)}` : ""}. Anything since then is lost. A running server starts again on it.`}
                    </PaperText>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
