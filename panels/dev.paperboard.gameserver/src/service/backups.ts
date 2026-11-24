// Each server's backups. A backup's target is the server's id; Game Server
// backs up one server at a time. Paperboard asks the service what a backup
// holds and when to carry on (the hooks below), and copies the files while
// the service keeps running:
//
// - beforeBackup readies the server's folder (Minecraft pauses saving, a
//   game that can't be copied while it runs saves and stops) and names it,
//   with the server's settings as the backup's data
// - afterBackup lets the server carry on: saving resumes, or it starts again
// - beforeRestore stops the server; afterRestore applies the backup's
//   settings, picks up its files, and starts the server again if it ran
//
// Every backup Game Server makes goes through backUp here, whether the
// page, a block or the routine schedule asked, so its Blocks events fire
// for each. The routine schedule is each server's own (backupSchedule.ts),
// run from one timer in this service.
import { backupApi, errorMessage, type BackupContents, type BackupRecord, type RestoreEnded } from "@mileniumhq/paperapi";
import type { Server, Settings } from "./server";
import { PANEL_ID } from "./contract";
import { appendCapped } from "./types";
import { fireBackupEnded, serverOperation } from "./blocks";
import { stopServerInstance } from "./lifecycle";
import { markResume, report, resumeIfMarked, settle, stoppedAndReleased } from "../games/serviceKit";
import { ROUTINE_BACKUP_LABEL, isRoutineLabel, routineBackupsToPrune, type BackupSchedule, type BackupScheduleChoice } from "../backupSchedule";

export interface BackupsHost {
    /** the server an id names; throws when there is none */
    server(id: string): Server;
    servers(): readonly Server[];
    /** what a server whose folder is the panel's whole storage (the legacy server) leaves out: the panel's own folders */
    panelFolders(): string[];
    /** maps the server's saved schedule in one config write; gives what was saved, null for a server since removed */
    saveSchedule(server: Server, change: (current: BackupSchedule | null) => BackupSchedule | null): Promise<BackupSchedule | null>;
    /** replaces the server's saved settings in one config write */
    replaceSettings(server: Server, settings: Settings): Promise<void>;
    /** reads the server's settings and files again, as its setup does, while it is stopped */
    reload(server: Server): Promise<void>;
}

/** the server a backup or restore is for */
function targeted(host: BackupsHost, target: string | null): Server {
    if (target === null) throw new Error("Game Server backs up one server at a time; choose a server");
    return host.server(target);
}

/** the server a backup or restore is for, if it can take one now */
function serverFor(host: BackupsHost, target: string | null): Server {
    const server = targeted(host, target);
    if (server.removing) throw new Error("This server was removed or is being removed");
    if (server.backupHold) throw new Error(`${server.name} is already being ${server.backupHold === "backup" ? "backed up" : "restored"}`);
    if (server.game.isMutating()) throw new Error(`${server.name} is installing or changing its files; try again once that finishes`);
    const status = server.state.serverStatus;
    if (status !== "online" && status !== "offline") throw new Error(`${server.name} is starting or stopping; try again once it has finished`);
    return server;
}

/** What a backup of the server holds: its folder, less what its game downloads again, and its settings. */
function contentsOf(host: BackupsHost, server: Server): BackupContents {
    const directory = server.stored.directory;
    const inFolder = (name: string) => (directory === "" ? name : `${directory}/${name}`);
    return {
        paths: [directory],
        // a folder that is the panel's whole storage holds the other servers and the panel's own records too
        exclude: [...(directory === "" ? host.panelFolders() : []), ...(server.game.backupExclude ?? []).map(inFolder)],
        skip: [...(server.game.backupSkip ?? [])],
        data: server.settings,
    };
}

/**
 * Ends the hold of a backup or restore that was refused, then lets the
 * server carry on as it was: saving resumes, or it starts again when the
 * preparation had stopped it. The hold goes first, or that start is refused.
 */
async function letGo(server: Server, what: string): Promise<void> {
    server.backupHold = null;
    await server.game.backup.after().catch((err) => report(server, `The server could not carry on after ${what}`, err));
    await resumeIfMarked(server, what);
}

export function backupHooks(host: BackupsHost) {
    return {
        async beforeBackup(target: string | null): Promise<BackupContents> {
            const server = serverFor(host, target);
            // held from here, with no await before it, so no start lands in the preparation
            server.backupHold = "backup";
            try {
                // the last run's cleanup puts back files the copy would catch half written
                await server.lifecycle.released;
                const contents = contentsOf(host, server);
                await server.game.backup.before();
                return contents;
            } catch (err) {
                await letGo(server, "the refused backup");
                throw err;
            }
        },
        async afterBackup(target: string | null): Promise<void> {
            const server = targeted(host, target);
            server.backupHold = null;
            await server.game.backup.after();
        },
        async beforeRestore(target: string | null): Promise<void> {
            const server = serverFor(host, target);
            // held from here, with no await before it, so no start lands between the stop and the swap
            server.backupHold = "restore";
            try {
                if (server.game.backup.mode === "offline") await server.game.backup.before();
                else if (await server.process.exists(server.game.primaryProcessId)) {
                    // the marker is what says it ran: it starts again at the end, or once a service that died meanwhile is back
                    await markResume(server);
                    server.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "info", content: "[Server] Stopping to restore a backup..." }) }));
                    await stopServerInstance(server);
                }
                // the run's cleanup (afterStop) is done before the files are swapped
                await stoppedAndReleased(server, 90_000, `${server.name} to stop`);
            } catch (err) {
                await letGo(server, "the refused restore");
                throw err;
            }
        },
        async afterRestore(ended: RestoreEnded): Promise<void> {
            const server = targeted(host, ended.target);
            if (!ended.ok) {
                // the files are as they were; a try that failed part way read the backup's
                try {
                    await host.reload(server);
                } finally {
                    server.backupHold = null;
                    await resumeIfMarked(server, "the restore that failed");
                }
                return;
            }
            // throwing puts the files back, and this hears the failure next
            const settings = ended.data;
            if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("The backup holds no settings for this server");
            const previous = server.settings;
            await host.replaceSettings(server, settings as Settings);
            try {
                await host.reload(server);
            } catch (err) {
                await host.replaceSettings(server, previous);
                throw err;
            }
            server.backupHold = null;
            await resumeIfMarked(server, "the restore");
        },
    };
}

async function makeBackup(server: Server, label: string | null): Promise<BackupRecord> {
    let record: BackupRecord;
    const failed = (what: string, err: unknown) => report(server, what, err);
    try {
        record = await backupApi.create(PANEL_ID, { target: server.id, ...(label ? { label } : {}) });
    } catch (err) {
        fireBackupEnded(server.blocks, { ok: false, error: errorMessage(err) }, failed);
        throw err;
    }
    fireBackupEnded(server.blocks, { ok: true, backup: record }, failed);
    return record;
}

/** Backs the server up now, as Back Up Now and Back Up the Server do; its Blocks events fire either way. */
export function backUp(server: Server, label: string | null | undefined): Promise<BackupRecord> {
    const name = label?.trim() || null;
    if (isRoutineLabel(name)) throw new Error(`"${ROUTINE_BACKUP_LABEL}" is kept for routine backups; choose another name`);
    return makeBackup(server, name);
}

/** Puts one of the server's backups back: its files, and its settings. */
export function restoreBackup(server: Server, backupId: string): Promise<BackupRecord> {
    return backupApi.restore(PANEL_ID, backupId, { target: server.id });
}

/** a routine backup that failed tries again this soon */
const RETRY_MS = 15 * 60 * 1000;
/** the timer wakes at least this often, so a changed clock is noticed */
const MAX_SLEEP_MS = 60 * 60 * 1000;
const hours = (n: number) => n * 60 * 60 * 1000;
const ROUTINE_FAILED = "The routine backup failed";

/** Each server's routine backups, run from one timer, one server at a time. */
export function routineBackups(host: BackupsHost, now = () => Date.now()) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running: Promise<void> | null = null;
    let stopped = false;
    let backoffUntil = 0;

    const scheduleOf = (server: Server) => server.stored.backupSchedule ?? null;

    function arm(): void {
        if (stopped || running) return;
        if (timer) clearTimeout(timer);
        const next = Math.min(...host.servers().map((server) => Date.parse(scheduleOf(server)?.nextRunAt ?? "")).filter(Number.isFinite));
        const due = Number.isFinite(next) ? next - now() : MAX_SLEEP_MS;
        const delay = Math.min(MAX_SLEEP_MS, Math.max(1000, due, backoffUntil - now()));
        timer = setTimeout(() => {
            timer = null;
            running = runDue().finally(() => {
                running = null;
                arm();
            });
        }, delay);
    }

    async function runDue(): Promise<void> {
        const due = host.servers()
            .filter((server) => Date.parse(scheduleOf(server)?.nextRunAt ?? "") <= now())
            .sort((a, b) => Date.parse(scheduleOf(a)!.nextRunAt) - Date.parse(scheduleOf(b)!.nextRunAt));
        for (const server of due) {
            if (stopped) return;
            await runOne(server);
        }
    }

    /** removes the server's routine backups beyond the newest `keep`; its other backups stay */
    async function prune(server: Server, keep: number): Promise<string | null> {
        try {
            for (const record of routineBackupsToPrune(await backupApi.list(PANEL_ID, { target: server.id }), keep)) {
                await backupApi.delete(PANEL_ID, record.id, { target: server.id });
            }
            return null;
        } catch (err) {
            return `Backed up, but older routine backups were not removed: ${errorMessage(err).slice(0, 400)}`;
        }
    }

    async function runOne(server: Server): Promise<void> {
        const schedule = scheduleOf(server);
        if (!schedule) return;
        let result: BackupSchedule["last"];
        let retrySoon = false;
        try {
            await serverOperation(server, () => makeBackup(server, ROUTINE_BACKUP_LABEL));
            const message = await prune(server, schedule.keep);
            result = { at: new Date(now()).toISOString(), ok: message === null, message };
            if (message === null) settle(server, ROUTINE_FAILED);
            else report(server, ROUTINE_FAILED, new Error(message));
        } catch (err) {
            retrySoon = true;
            result = { at: new Date(now()).toISOString(), ok: false, message: errorMessage(err).slice(0, 500) };
            report(server, ROUTINE_FAILED, err);
        }
        try {
            await host.saveSchedule(server, (current) => current && {
                ...current,
                last: result,
                // a schedule changed meanwhile keeps the time it was given
                nextRunAt: current.nextRunAt === schedule.nextRunAt
                    ? new Date(now() + (retrySoon ? Math.min(RETRY_MS, hours(current.everyHours)) : hours(current.everyHours))).toISOString()
                    : current.nextRunAt,
            });
        } catch (err) {
            // the backup stays due in the saved servers; waiting keeps it from running again at once
            backoffUntil = now() + RETRY_MS;
            report(server, "The routine backup's result could not be saved", err);
        }
    }

    return {
        /** starts the timer; the service calls it once its servers are set up */
        start: arm,
        stop(): void {
            stopped = true;
            if (timer) clearTimeout(timer);
            timer = null;
        },
        /**
         * Turns the server's routine backups on, changes them, or (with null)
         * turns them off. The first is one interval away; changing only how
         * many are kept leaves the next one when it was.
         */
        async set(server: Server, choice: BackupScheduleChoice | null): Promise<BackupSchedule | null> {
            if (choice && !(await backupApi.status(PANEL_ID, { target: server.id })).location) throw new Error("Choose where this server's backups go first");
            const saved = await host.saveSchedule(server, (current) => choice && {
                everyHours: choice.everyHours,
                keep: choice.keep,
                nextRunAt: current && current.everyHours === choice.everyHours ? current.nextRunAt : new Date(now() + hours(choice.everyHours)).toISOString(),
                last: current?.last ?? null,
            });
            arm();
            return saved;
        },
    };
}
