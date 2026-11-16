import { type Component, createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperModal, PaperSelector, PaperSelectorItem, PaperText, createAction, createRead } from "@mileniumhq/paperui";
import { backupApi, backupLocationLabel, backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { createLocationUsage, usageText } from "./locationUsage";
import { LocationLogo } from "./providers";
import { createOpenings } from "../../lib/openings";

export type BackupLocationChoice = { status: "chosen"; location: BackupLocation } | { status: "canceled" } | { status: "failed"; message: string };

// The window a panel opens with backupApi.chooseLocation: the computer's
// backup locations with how much space each has, and which one this
// panel's backups go to. Only the shell sets the choice. It stays mounted and
// opens per request, so PaperModal plays its own open and close.
const BackupLocationChooser: Component<{ computerId: string; computerName: string; panelId: string; panelName: string; sourceId?: string; open: boolean; onDone: (choice: BackupLocationChoice) => void }> = (props) => {
    // read afresh each time it opens: the list, and the location this panel's backups go to now
    const read = createRead(
        async () => {
            const [locations, status] = await Promise.all([backupLocationsApi.list(props.computerId), props.sourceId ? backupApi.forSource(props.panelId, props.sourceId, props.computerId).status() : backupApi.status(props.panelId, props.computerId)]);
            return { locations, chosen: status.location?.id ?? locations[0]?.id ?? "" };
        },
        { source: () => props.open },
    );
    // the list as this opening read it: the last opening's goes while the new one is read
    const locations = () => (read.loading() ? undefined : read.value()?.locations);
    // what the person picked in this opening, else the location in use
    const [picked, setPicked] = createSignal<string | null>(null);
    const selected = () => picked() ?? read.value()?.chosen ?? "";
    const save = createAction();
    const saving = save.busy;
    // a save started in one opening must not finish a later one
    const openings = createOpenings();
    let opening = 0;
    const finish = (choice: BackupLocationChoice, token = opening) => {
        if (openings.answer(token)) props.onDone(choice);
    };
    // the window cannot be dismissed while the choice is being saved: the
    // computer would keep a choice the panel was told was canceled
    const dismiss = () => {
        if (!saving()) finish({ status: "canceled" });
    };
    createEffect(on(() => props.open, (open) => {
        if (!open) return;
        opening = openings.open();
        setPicked(null);
    }));

    const choose = async () => {
        const token = opening;
        await save.run("Couldn't use this location", async () => {
            try {
                const status = await backupLocationsApi.setForPanel(props.panelId, selected(), props.computerId, props.sourceId);
                if (!status.location) throw new Error("The computer did not keep the choice");
                finish({ status: "chosen", location: status.location }, token);
            } catch (err) {
                // a save from an opening that is over has no one to tell
                if (openings.isCurrent(token)) throw err;
            }
        });
    };

    return (
        <PaperModal
            open={props.open}
            title={`Where should ${props.panelName} backups go?`}
            size="small"
            onClose={dismiss}
            footer={
                <>
                    <PaperButton variant="text" disabled={saving()} onClick={dismiss}>Cancel</PaperButton>
                    <PaperButton disabled={saving() || !locations() || !selected()} onClick={() => void choose()}>{saving() ? "Saving..." : "Use this location"}</PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="text">This panel's files and settings are copied here each time it makes a backup.</PaperText>
                <Show when={read.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't load backup locations"
                            error={err()}
                            action={{ label: "Try again", disabled: read.loading(), onClick: () => void read.reload() }}
                        />
                    )}
                </Show>
                <Show when={locations()} fallback={<Show when={!read.error()}><PaperText preset="hint">Loading locations…</PaperText></Show>}>
                    {(list) => (
                        <PaperSelector name="backup-location" value={selected()} onValueChange={(value) => setPicked(String(value))}>
                            <For each={list()}>
                                {(location) => {
                                    const usage = createLocationUsage(location.id, props.computerId);
                                    return (
                                        <PaperSelectorItem value={location.id} icon={<LocationLogo kind={location.kind} />} description={
                                            // where it is, and how full, each on its own line
                                            <PaperFlex direction="column">
                                                <span>{location.detail}</span>
                                                <span>{usageText(usage)}</span>
                                            </PaperFlex>
                                        }>
                                            {backupLocationLabel(location, props.computerName)}
                                        </PaperSelectorItem>
                                    );
                                }}
                            </For>
                        </PaperSelector>
                    )}
                </Show>
                <PaperText preset="hint">Add Google Drive or an S3 bucket in {props.computerName}'s Computer Info.</PaperText>
            </PaperFlex>
        </PaperModal>
    );
};

export default BackupLocationChooser;
