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
import { ACTIONS_PANEL_ID } from "../panelId";
import type { CanvasDocument } from "../lib/canvasDoc";
import { flowFileText, MAX_FLOW_FILE_BYTES, parseFlowFile } from "../lib/flowFile";

const FLOW_FILE_FILTERS = [{ name: "Flow files", extensions: ["json"] }];

function sizeText(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const addedText = (file: CanvasDocument) =>
    [counted(file.flows.length, "flow"), counted(file.notes.length, "note"), counted(file.functions.length, "function")]
        .filter((part) => !part.startsWith("0 "))
        .join(", ");

// a name a file can have on any computer
const fileName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "Flows";

const dateText = (iso: string) => new Date(iso).toLocaleString();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// what finished or failed: a title naming the operation, and what happened
export type CanvasNotice = { kind: "done" | "failed"; title: string; text: string };

// The File menu's work: a project's canvas out to a file and back in, and
// backups of everything Actions keeps (every project's flows, notes,
// functions and variables). The operations go in the menu; the Load Backup
// window is drawn by the returned component.
export function createCanvasFileActions(props: {
    /** a stable id for this window, so two windows never share a temporary file */
    clientId: string;
    /** the project's name, which an exported file is named after */
    name: () => string;
    loaded: () => boolean;
    canvas: () => CanvasDocument;
    /** adds the file beside the canvas and saves */
    add: (file: CanvasDocument) => void;
    /** saves the latest edits now; false with a reason when they did not save */
    flush: () => Promise<{ ok: true } | { ok: false; message: string }>;
    /** shows the canvas the service has now */
    reload: () => Promise<import("../lib/canvasSync").CanvasSyncResult>;
    onNotice: (notice: CanvasNotice) => void;
}) {
    const [busy, setBusy] = createSignal(false);

    const run = async (titles: { done: string; failed: string }, work: () => Promise<string | null>) => {
        if (busy()) return;
        setBusy(true);
        try {
            const done = await work();
            if (done) props.onNotice({ kind: "done", title: titles.done, text: done });
        } catch (err) {
            props.onNotice({ kind: "failed", title: titles.failed, text: message(err) });
        } finally {
            setBusy(false);
        }
    };

    // the export and import copy through a file in Actions' own storage,
    // which is removed again whatever happens
    const exportFlows = () => run({ done: "Flows exported", failed: "Flows not exported" }, async () => {
        const path = `flows-export-${props.clientId}.json`;
        await fileApi.write(path, flowFileText(props.canvas()), ACTIONS_PANEL_ID);
        try {
            const result = await fileApi.exportFile(path, ACTIONS_PANEL_ID, { suggestedName: `${fileName(props.name())}.json`, filters: FLOW_FILE_FILTERS });
            return result.status === "exported" ? `Exported to ${result.name}.` : null;
        } finally {
            await fileApi.delete(path, ACTIONS_PANEL_ID);
        }
    });

    const importFlows = () => run({ done: "Flows imported", failed: "Flows not imported" }, async () => {
        if (!props.loaded()) throw new Error("The canvas has not loaded yet, so nothing can be added to it.");
        const path = `flows-import-${props.clientId}.json`;
        const result = await fileApi.importFile(path, ACTIONS_PANEL_ID, { filters: FLOW_FILE_FILTERS });
        if (result.status === "canceled") return null;
        let text: string | null;
        try {
            if (result.bytes > MAX_FLOW_FILE_BYTES) throw new Error("This file is too big to be a flow file.");
            text = await fileApi.read(path, ACTIONS_PANEL_ID);
        } finally {
            await fileApi.delete(path, ACTIONS_PANEL_ID);
        }
        if (text === null) throw new Error("The imported file could not be read.");
        const file = parseFlowFile(text);
        props.add(file);
        return `Added ${addedText(file)} from ${result.name}.`;
    });

    // a backup needs somewhere to go; the first one asks where
    const ensureLocation = async (): Promise<boolean> => {
        const status = await backupApi.status(ACTIONS_PANEL_ID);
        if (status.location) return true;
        return (await backupApi.chooseLocation(ACTIONS_PANEL_ID)).status === "chosen";
    };

    const createBackup = () => run({ done: "Backup made", failed: "Backup not made" }, async () => {
        if (!(await ensureLocation())) return null;
        const saved = await props.flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved, so the backup would miss them: ${saved.message}`);
        const record = await backupApi.create(ACTIONS_PANEL_ID);
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
            const [now, list] = await Promise.all([backupApi.status(ACTIONS_PANEL_ID), backupApi.list(ACTIONS_PANEL_ID)]);
            setStatus(now);
            setBackups(list);
            setSelected(list[0]?.id ?? "");
        } catch (err) {
            setLoadError({ title: "Backups not listed", text: message(err) });
        }
    };

    const openLoad = async () => {
        if (busy()) return;
        setRestoring(false);
        try {
            if (!(await ensureLocation())) return;
        } catch (err) {
            props.onNotice({ kind: "failed", title: "Backups not opened", text: message(err) });
            return;
        }
        setLoadOpen(true);
        void loadBackups();
    };

    const changeLocation = async () => {
        try {
            if ((await backupApi.chooseLocation(ACTIONS_PANEL_ID)).status === "chosen") void loadBackups();
        } catch (err) {
            setLoadError({ title: "Backup location not changed", text: message(err) });
        }
    };

    const restore = async () => {
        const record = backups()?.find((b) => b.id === selected());
        if (!record) return;
        setRestoring(true);
        setLoadError(null);
        try {
            await backupApi.restore(ACTIONS_PANEL_ID, record.id);
        } catch (err) {
            setLoadError({ title: "Backup not loaded", text: message(err) });
            setRestoring(false);
            return;
        }
        setLoadOpen(false);
        setRestoring(false);
        try {
            const reloaded = await props.reload();
            if (!reloaded.ok) throw new Error(reloaded.message);
            props.onNotice({ kind: "done", title: "Backup loaded", text: `Loaded the backup from ${dateText(record.createdAt)}.` });
        } catch (err) {
            props.onNotice({ kind: "failed", title: "Backup not shown", text: `The backup was loaded, but the canvas could not show it: ${message(err)}` });
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
                <PaperText preset="body">Loading a backup replaces every project, with its flows, notes, functions and variables, with the backup's. Flows running now stop.</PaperText>
                <Show when={backups()} fallback={<Show when={!loadError()}><PaperLoader loaderStatus="indeterminate" size="small" label="Loading backups" /></Show>}>
                    {(list) => (
                        <Show when={list().length > 0} fallback={<PaperText size={2} color="text-subtle">No backups here yet. Make one with File, then Create backup.</PaperText>}>
                            <PaperSelector name="actions-backup" value={selected()} onValueChange={(value) => setSelected(String(value))}>
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
                            <PaperText size={2} color="text-subtle">Kept in {location().label}</PaperText>
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
