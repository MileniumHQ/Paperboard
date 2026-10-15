import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    useContextMenuState,
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

const dateText = (iso: string) => new Date(iso).toLocaleString();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type CanvasNotice = { kind: "done" | "failed"; text: string };

// The menu beside Run: the canvas out to a file and back in, and backups of
// everything Actions keeps (flows, notes, functions, variables).
export default function CanvasFileMenu(props: {
    /** a stable id for this window, so two windows never share a temporary file */
    clientId: string;
    loaded: () => boolean;
    canvas: () => CanvasDocument;
    /** adds the file beside the canvas and saves */
    add: (file: CanvasDocument) => void;
    /** saves the latest edits now; false with a reason when they did not save */
    flush: () => Promise<{ ok: true } | { ok: false; message: string }>;
    /** shows the canvas the service has now */
    reload: () => Promise<void>;
    onNotice: (notice: CanvasNotice) => void;
}) {
    const menu = useContextMenuState("below-right");
    const [busy, setBusy] = createSignal(false);

    const run = async (work: () => Promise<string | null>) => {
        if (busy()) return;
        setBusy(true);
        try {
            const done = await work();
            if (done) props.onNotice({ kind: "done", text: done });
        } catch (err) {
            props.onNotice({ kind: "failed", text: message(err) });
        } finally {
            setBusy(false);
        }
    };

    // the export and import copy through a file in Actions' own storage,
    // which is removed again whatever happens
    const exportFlows = () => run(async () => {
        const path = `flows-export-${props.clientId}.json`;
        await fileApi.write(path, flowFileText(props.canvas()), ACTIONS_PANEL_ID);
        try {
            const result = await fileApi.exportFile(path, ACTIONS_PANEL_ID, { suggestedName: "Flows.json", filters: FLOW_FILE_FILTERS });
            return result.status === "exported" ? `Exported to ${result.name}.` : null;
        } finally {
            await fileApi.delete(path, ACTIONS_PANEL_ID);
        }
    });

    const importFlows = () => run(async () => {
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

    const createBackup = () => run(async () => {
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
    const [loadError, setLoadError] = createSignal("");
    const [restoring, setRestoring] = createSignal(false);

    const loadBackups = async () => {
        setLoadError("");
        setBackups(null);
        try {
            const [now, list] = await Promise.all([backupApi.status(ACTIONS_PANEL_ID), backupApi.list(ACTIONS_PANEL_ID)]);
            setStatus(now);
            setBackups(list);
            setSelected(list[0]?.id ?? "");
        } catch (err) {
            setLoadError(`Backups could not be listed: ${message(err)}`);
        }
    };

    const openLoad = async () => {
        if (busy()) return;
        setRestoring(false);
        try {
            if (!(await ensureLocation())) return;
        } catch (err) {
            props.onNotice({ kind: "failed", text: message(err) });
            return;
        }
        setLoadOpen(true);
        void loadBackups();
    };

    const changeLocation = async () => {
        try {
            if ((await backupApi.chooseLocation(ACTIONS_PANEL_ID)).status === "chosen") void loadBackups();
        } catch (err) {
            setLoadError(message(err));
        }
    };

    const restore = async () => {
        const record = backups()?.find((b) => b.id === selected());
        if (!record) return;
        setRestoring(true);
        setLoadError("");
        try {
            await backupApi.restore(ACTIONS_PANEL_ID, record.id);
        } catch (err) {
            setLoadError(`The backup was not loaded: ${message(err)}`);
            setRestoring(false);
            return;
        }
        setLoadOpen(false);
        setRestoring(false);
        try {
            await props.reload();
            props.onNotice({ kind: "done", text: `Loaded the backup from ${dateText(record.createdAt)}.` });
        } catch (err) {
            props.onNotice({ kind: "failed", text: `The backup was loaded, but the canvas could not show it: ${message(err)}` });
        }
    };

    return (
        <>
            <PaperButton icon disabled={busy()} title="Export, import and backups" aria-label="Export, import and backups"
                onClick={(e) => menu.openBelow(e, { align: "right" })}>
                <PaperIcon>{busy() ? "progress_activity" : "more_vert"}</PaperIcon>
            </PaperButton>
            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <PaperContextMenuItem icon="file_export" onClick={() => { menu.close(); void exportFlows(); }}>Export</PaperContextMenuItem>
                <PaperContextMenuItem icon="file_open" onClick={() => { menu.close(); void importFlows(); }}>Import</PaperContextMenuItem>
                <PaperContextMenuItem icon="backup" onClick={() => { menu.close(); void createBackup(); }}>Create Backup</PaperContextMenuItem>
                <PaperContextMenuItem icon="settings_backup_restore" onClick={() => { menu.close(); void openLoad(); }}>Load Backup</PaperContextMenuItem>
            </PaperContextMenu>
            <PaperModal
                open={loadOpen()}
                title="Load a backup"
                size="small"
                onClose={() => { if (!restoring()) setLoadOpen(false); }}
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton variant="text" disabled={restoring()} onClick={() => setLoadOpen(false)}>Cancel</PaperButton>
                        <Show when={loadError() && !backups()} fallback={
                            <PaperButton variant="danger" disabled={restoring() || !selected()} onClick={() => void restore()}>
                                {restoring() ? "Loading..." : "Load backup"}
                            </PaperButton>
                        }>
                            <PaperButton onClick={() => void loadBackups()}>Try again</PaperButton>
                        </Show>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">Loading a backup replaces all flows, notes, functions and variables with the backup's. Flows running now stop.</PaperText>
                    <Show when={backups()} fallback={<Show when={!loadError()}><PaperText size={2} color="text-subtle">Loading backups…</PaperText></Show>}>
                        {(list) => (
                            <Show when={list().length > 0} fallback={<PaperText size={2} color="text-subtle">No backups here yet. Make one with Create Backup.</PaperText>}>
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
                        <PaperText size={2} color="danger">{loadError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
