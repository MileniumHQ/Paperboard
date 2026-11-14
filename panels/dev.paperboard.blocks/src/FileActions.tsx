import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperLoader,
    PaperModal,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
} from "@mileniumhq/paperui";
import { backupApi, fileApi, type BackupRecord, type BackupStatus } from "@mileniumhq/paperapi";
import { PANEL_ID, type SavedFlows } from "./panel";
import type { Notice } from "./bridge";
import { errorMessage } from "./lib/failure";
import { flowFileText, MAX_FLOW_FILE_BYTES, parseFlowFile } from "./lib/flowFile";

const FLOW_FILE_FILTERS = [{ name: "Flow files", extensions: ["json"] }];

function sizeText(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const addedText = (file: SavedFlows) => counted(file.workspace.blocks?.blocks.length ?? 0, "stack");

// a name a file can have on any computer
const fileName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "Flows";

const dateText = (iso: string) => new Date(iso).toLocaleString();

// The File and Backup menus' work: a
// project's flows out to a file and back in, and backups of everything
// Blocks keeps (every project and its flows). The operations go in the
// menus; the Load Backup window is drawn by the returned component.
export function createFileActions(props: {
    /** the project's name, which an exported file is named after */
    name: () => string;
    loaded: () => boolean;
    snapshot: () => SavedFlows;
    /** adds the file's flows below the canvas's and saves */
    add: (flows: SavedFlows) => Promise<void>;
    /** saves the latest edits now; false with a reason when they did not save */
    flush: () => Promise<{ ok: true } | { ok: false; message: string }>;
    /** shows the flows the service has now */
    reload: () => Promise<void>;
    onNotice: (notice: Notice) => void;
}) {
    // this window's own temporary file names, so two windows never share one
    const clientId = crypto.randomUUID();
    const [busy, setBusy] = createSignal(false);

    const run = async (titles: { done: string; failed: string }, work: () => Promise<string | null>) => {
        if (busy()) return;
        setBusy(true);
        try {
            const done = await work();
            if (done) props.onNotice({ kind: "done", title: titles.done, text: done });
        } catch (err) {
            props.onNotice({ kind: "failed", title: titles.failed, text: errorMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    // the export and import copy through a file in Blocks' own storage,
    // which is removed again whatever happens: a removal that fails is said
    // too, after what the work itself did
    const removedAfter = async <T,>(path: string, work: () => Promise<T>): Promise<T> => {
        let done: T;
        try {
            done = await work();
        } catch (err) {
            await fileApi.delete(path, PANEL_ID).catch((why: unknown) => {
                throw new Error(`${errorMessage(err)} The temporary file ${path} wasn't removed either: ${errorMessage(why)}`);
            });
            throw err;
        }
        await fileApi.delete(path, PANEL_ID).catch((why: unknown) => {
            throw new Error(`That much worked, but the temporary file ${path} wasn't removed: ${errorMessage(why)}`);
        });
        return done;
    };
    const exportFlows = () => run({ done: "Flows exported", failed: "Flows not exported" }, async () => {
        const path = `flows-export-${clientId}.json`;
        // what is exported is what is saved, so the latest edits go first
        const saved = await props.flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved, so the file would miss them: ${saved.message}`);
        await fileApi.write(path, flowFileText(props.snapshot()), PANEL_ID);
        const result = await removedAfter(path, () => fileApi.exportFile(path, PANEL_ID, { suggestedName: `${fileName(props.name())}.json`, filters: FLOW_FILE_FILTERS }));
        return result.status === "exported" ? `Exported to ${result.name}.` : null;
    });

    const importFlows = () => run({ done: "Flows imported", failed: "Flows not imported" }, async () => {
        if (!props.loaded()) throw new Error("The canvas has not loaded yet, so nothing can be added to it.");
        const path = `flows-import-${clientId}.json`;
        const result = await fileApi.importFile(path, PANEL_ID, { filters: FLOW_FILE_FILTERS });
        if (result.status === "canceled") return null;
        const text = await removedAfter(path, async () => {
            if (result.bytes > MAX_FLOW_FILE_BYTES) throw new Error("This file is too big to be a flow file.");
            return fileApi.read(path, PANEL_ID);
        });
        if (text === null) throw new Error("The imported file could not be read.");
        const file = parseFlowFile(text);
        await props.add(file);
        return `Added ${addedText(file)} from ${result.name}.`;
    });

    // a backup needs somewhere to go; the first one asks where
    const ensureLocation = async (): Promise<boolean> => {
        const status = await backupApi.status(PANEL_ID);
        if (status.location) return true;
        return (await backupApi.chooseLocation(PANEL_ID)).status === "chosen";
    };

    const createBackup = () => run({ done: "Backup made", failed: "Backup not made" }, async () => {
        if (!(await ensureLocation())) return null;
        const saved = await props.flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved, so the backup would miss them: ${saved.message}`);
        const record = await backupApi.create(PANEL_ID);
        return `Backed up (${sizeText(record.size)}).`;
    });

    // Load Backup: the list, the chosen one, and where they are kept. The
    // window stays mounted so PaperModal plays its own open and close.
    const [loadOpen, setLoadOpen] = createSignal(false);
    const [backups, setBackups] = createSignal<BackupRecord[] | null>(null);
    const [status, setStatus] = createSignal<BackupStatus | null>(null);
    const [selected, setSelected] = createSignal("");
    const [loadError, setLoadError] = createSignal<{ title: string; text: string } | null>(null);
    const [restoring, setRestoring] = createSignal(false);

    const loadBackups = async () => {
        setLoadError(null);
        setBackups(null);
        try {
            const [now, list] = await Promise.all([backupApi.status(PANEL_ID), backupApi.list(PANEL_ID)]);
            setStatus(now);
            setBackups(list);
            setSelected(list[0]?.id ?? "");
        } catch (err) {
            setLoadError({ title: "Backups not listed", text: errorMessage(err) });
        }
    };

    const openLoad = async () => {
        if (busy()) return;
        setRestoring(false);
        try {
            if (!(await ensureLocation())) return;
        } catch (err) {
            props.onNotice({ kind: "failed", title: "Backups not opened", text: errorMessage(err) });
            return;
        }
        setLoadOpen(true);
        void loadBackups();
    };

    const changeLocation = async () => {
        try {
            if ((await backupApi.chooseLocation(PANEL_ID)).status === "chosen") void loadBackups();
        } catch (err) {
            setLoadError({ title: "Backup location not changed", text: errorMessage(err) });
        }
    };

    const restore = async () => {
        const record = backups()?.find((b) => b.id === selected());
        if (!record) return;
        setRestoring(true);
        setLoadError(null);
        try {
            await backupApi.restore(PANEL_ID, record.id);
        } catch (err) {
            setLoadError({ title: "Backup not loaded", text: errorMessage(err) });
            setRestoring(false);
            return;
        }
        setLoadOpen(false);
        setRestoring(false);
        try {
            await props.reload();
            props.onNotice({ kind: "done", title: "Backup loaded", text: `Loaded the backup from ${dateText(record.createdAt)}.` });
        } catch (err) {
            props.onNotice({ kind: "failed", title: "Backup not shown", text: `The backup was loaded, but the canvas could not show it: ${errorMessage(err)}` });
        }
    };

    // always mounted: the modal opens and closes through its open prop
    function LoadBackupModal() {
        return <PaperModal
            open={loadOpen()}
            title="Load a backup"
            size="small"
            onClose={() => { if (!restoring()) setLoadOpen(false); }}
            footer={
                <>
                    <PaperButton variant="text" disabled={restoring()} onClick={() => setLoadOpen(false)}>Cancel</PaperButton>
                    <Show when={loadError() && !backups()} fallback={
                        <PaperButton variant="danger" disabled={restoring() || !selected()} onClick={() => void restore()}>
                            {restoring() ? "Loading..." : "Load backup"}
                        </PaperButton>
                    }>
                        <PaperButton onClick={() => void loadBackups()}>Try again</PaperButton>
                    </Show>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="text">Loading a backup replaces every project, with its flows and variables, with the backup's. Flows running now stop.</PaperText>
                <Show when={backups()} fallback={<Show when={!loadError()}><PaperLoader loaderStatus="indeterminate" size="small" label="Loading backups" /></Show>}>
                    {(list) => (
                        <Show when={list().length > 0} fallback={<PaperText preset="hint">No backups here yet. Make one with Backup, then Create backup.</PaperText>}>
                            <PaperSelector name="blocks-backup" value={selected()} onValueChange={(value) => setSelected(String(value))}>
                                <For each={list()}>
                                    {(record) => (
                                        <PaperSelectorItem value={record.id} icon="history" description={sizeText(record.size)}>
                                            {record.label || dateText(record.createdAt)}
                                        </PaperSelectorItem>
                                    )}
                                </For>
                            </PaperSelector>
                        </Show>
                    )}
                </Show>
                <Show when={status()?.location}>
                    {(location) => (
                        <PaperFlex direction="row" align="center" justify="space-between" gap="half" fullWidth>
                            <PaperText preset="hint">Kept in {location().label}</PaperText>
                            <PaperButton size="tiny" variant="text" disabled={restoring()} onClick={() => void changeLocation()}>Change</PaperButton>
                        </PaperFlex>
                    )}
                </Show>
                <Show when={loadError()}>
                    {(failure) => (
                        <PaperQuote variant="danger" icon="warning" title={failure().title} role="alert">
                            {failure().text}
                        </PaperQuote>
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>;
    }

    return { busy, exportFlows, importFlows, createBackup, openLoad, LoadBackupModal };
}
