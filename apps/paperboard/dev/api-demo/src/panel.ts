// The API Demo page: a note kept in the panel's storage, exported and
// imported through Paperboard's pickers, and backed up to the location the
// user chooses. Every outcome, failures included, is shown on the page.
import "@mileniumhq/paperui/style.css";
import "./style.css";
import { backupApi, createPanelBridge, fileApi, type BackupRecord } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panelId";

const NOTE = "note.txt";
const bridge = createPanelBridge<{ startedAt: number; noteAtStart: string }>({ panelId: PANEL_ID, defaultState: { startedAt: 0, noteAtStart: "" } });

const app = document.getElementById("app")!;
app.className = "demo-panel";
app.innerHTML = `
<h1>API Demo</h1>
<p class="muted">Exercises exporting and importing files and backups. A development fixture, not a released panel.</p>
<section aria-labelledby="files-title">
    <h2 id="files-title">Files</h2>
    <label for="note">The note, saved as ${NOTE} in this panel's storage</label>
    <textarea id="note"></textarea>
    <div class="row">
        <button type="button" data-do="save">Save note</button>
        <button type="button" data-do="export">Export note…</button>
        <button type="button" data-do="import">Import note…</button>
    </div>
    <p class="muted" data-out="service"></p>
</section>
<section aria-labelledby="backups-title">
    <h2 id="backups-title">Backups</h2>
    <p data-out="location"></p>
    <div class="row">
        <button type="button" data-do="choose">Choose backup location…</button>
        <input id="label" aria-label="Backup label" placeholder="Label (optional)" maxlength="100">
        <button type="button" data-do="create">Back up now</button>
        <button type="button" data-do="refresh">Refresh list</button>
    </div>
    <ul class="backups" aria-label="Backups"></ul>
</section>
<p role="status" aria-live="polite" data-out="result"></p>`;

const $ = <T extends Element>(selector: string) => app.querySelector<T>(selector)!;
const note = $<HTMLTextAreaElement>("#note");
const label = $<HTMLInputElement>("#label");
const list = $<HTMLUListElement>(".backups");
const say = (text: string) => ($("[data-out=result]").textContent = text);
const failure = (what: string, err: unknown) => say(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);

const showService = () => {
    const { startedAt, noteAtStart } = bridge.getState();
    $("[data-out=service]").textContent = startedAt
        ? `The service started at ${new Date(startedAt).toLocaleTimeString()} and read the note as "${noteAtStart.slice(0, 60)}".`
        : "The service has not answered yet.";
};
bridge.onStateChange(showService);
showService();

async function loadNote() {
    try {
        note.value = (await fileApi.read(NOTE, PANEL_ID)) ?? "";
    } catch (err) {
        failure("Reading the note", err);
    }
}

async function loadBackups() {
    try {
        const status = await backupApi.status(PANEL_ID);
        $("[data-out=location]").textContent = status.location
            ? `Backups go to ${status.location.label} (${status.location.detail}).${status.running ? ` A backup is ${status.running === "create" ? "being made" : "being restored"}.` : ""}`
            : "No backup location chosen yet.";
        list.replaceChildren();
        if (!status.location) return;
        const backups = await backupApi.list(PANEL_ID);
        if (backups.length === 0) list.append(Object.assign(document.createElement("li"), { textContent: "No backups yet.", className: "muted" }));
        for (const backup of backups) list.append(backupRow(backup));
    } catch (err) {
        list.replaceChildren();
        failure("Loading backups", err);
    }
}

function backupRow(backup: BackupRecord): HTMLLIElement {
    const row = document.createElement("li");
    row.className = "row";
    const text = document.createElement("span");
    text.textContent = `${new Date(backup.createdAt).toLocaleString()}${backup.label ? `, ${backup.label}` : ""}, ${backup.size} bytes, version ${backup.panelVersion ?? "unknown"}`;
    const restore = Object.assign(document.createElement("button"), { type: "button", textContent: "Restore" });
    restore.setAttribute("aria-label", `Restore the backup from ${new Date(backup.createdAt).toLocaleString()}`);
    restore.addEventListener("click", () =>
        run(`Restoring ${backup.id}`, async () => {
            await backupApi.restore(PANEL_ID, backup.id);
            await Promise.all([loadNote(), bridge.refreshState()]);
            return `Restored the backup from ${new Date(backup.createdAt).toLocaleString()}.`;
        }),
    );
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete" });
    remove.setAttribute("aria-label", `Delete the backup from ${new Date(backup.createdAt).toLocaleString()}`);
    remove.addEventListener("click", () =>
        run(`Deleting ${backup.id}`, async () => {
            await backupApi.delete(PANEL_ID, backup.id);
            return "Deleted the backup.";
        }),
    );
    row.append(text, restore, remove);
    return row;
}

// one action at a time, so a slow backup cannot be started twice
let busy = false;
async function run(what: string, fn: () => Promise<string>) {
    if (busy) return;
    busy = true;
    for (const button of app.querySelectorAll("button")) button.disabled = true;
    say(`${what}…`);
    try {
        say(await fn());
    } catch (err) {
        failure(what, err);
    } finally {
        busy = false;
        for (const button of app.querySelectorAll("button")) button.disabled = false;
        await loadBackups();
    }
}

const actions: Record<string, () => void> = {
    save: () => run("Saving the note", async () => {
        await fileApi.write(NOTE, note.value, PANEL_ID);
        return "Saved the note.";
    }),
    export: () => run("Exporting the note", async () => {
        const result = await fileApi.exportFile(NOTE, PANEL_ID, { suggestedName: "note.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
        return result.status === "exported" ? `Exported ${result.bytes} bytes as ${result.name}.` : "Export canceled.";
    }),
    import: () => run("Importing a note", async () => {
        const result = await fileApi.importFile(NOTE, PANEL_ID, { filters: [{ name: "Text", extensions: ["txt"] }] });
        if (result.status === "canceled") return "Import canceled.";
        await loadNote();
        return `Imported ${result.bytes} bytes from ${result.name}.`;
    }),
    choose: () => run("Choosing a backup location", async () => {
        const result = await backupApi.chooseLocation(PANEL_ID);
        return result.status === "chosen" ? `Backups now go to ${result.location.label}.` : "Kept the backup location as it was.";
    }),
    create: () => run("Backing up", async () => {
        const backup = await backupApi.create(PANEL_ID, { label: label.value.trim() || undefined });
        label.value = "";
        return `Backed up ${backup.size} bytes.`;
    }),
    refresh: () => run("Refreshing", async () => "Refreshed."),
};
for (const button of app.querySelectorAll<HTMLButtonElement>("[data-do]")) {
    button.addEventListener("click", () => actions[button.dataset.do!]());
}

void loadNote();
void loadBackups();
