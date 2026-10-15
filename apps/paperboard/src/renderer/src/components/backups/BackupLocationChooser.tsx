import { type Component, createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperModal, PaperSelector, PaperSelectorItem, PaperText } from "@mileniumhq/paperui";
import { backupApi, backupLocationLabel, backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { loadUsage, usageText, type UsageState } from "./locationUsage";
import { LocationLogo } from "./providers";
import { createOpenings } from "../../lib/openings";

export type BackupLocationChoice = { status: "chosen"; location: BackupLocation } | { status: "canceled" } | { status: "failed"; message: string };

// The window a panel opens with backupApi.chooseLocation: the computer's
// backup locations with how much space each has, and which one this
// panel's backups go to. Only the shell sets the choice. It stays mounted and
// opens per request, so PaperModal plays its own open and close.
const BackupLocationChooser: Component<{ computerId: string; computerName: string; panelId: string; open: boolean; onDone: (choice: BackupLocationChoice) => void }> = (props) => {
    const [locations, setLocations] = createSignal<BackupLocation[] | null>(null);
    const [usage, setUsage] = createSignal<Record<string, UsageState>>({});
    const [selected, setSelected] = createSignal("");
    const [error, setError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    // a load or save started in one opening must not finish a later one
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

    const load = async () => {
        const token = opening;
        setError("");
        setLocations(null);
        try {
            const [list, status] = await Promise.all([backupLocationsApi.list(props.computerId), backupApi.status(props.panelId, props.computerId)]);
            if (!openings.isCurrent(token)) return;
            setLocations(list);
            setSelected(status.location?.id ?? list[0]?.id ?? "");
            for (const location of list) {
                setUsage((prev) => ({ ...prev, [location.id]: { kind: "loading" } }));
                void loadUsage(location.id, props.computerId).then((state) => setUsage((prev) => ({ ...prev, [location.id]: state })));
            }
        } catch (err) {
            if (openings.isCurrent(token)) setError(`Backup locations could not be loaded: ${(err as Error)?.message ?? err}`);
        }
    };
    createEffect(on(() => props.open, (open) => {
        if (!open) return;
        opening = openings.open();
        setSaving(false);
        void load();
    }));

    const choose = async () => {
        const token = opening;
        setSaving(true);
        setError("");
        try {
            const status = await backupLocationsApi.setForPanel(props.panelId, selected(), props.computerId);
            if (!status.location) throw new Error("The computer did not keep the choice");
            finish({ status: "chosen", location: status.location }, token);
        } catch (err) {
            if (openings.isCurrent(token)) setError((err as Error)?.message ?? String(err));
        } finally {
            if (openings.isCurrent(token)) setSaving(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            title="Where should backups go?"
            size="small"
            onClose={dismiss}
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton variant="text" disabled={saving()} onClick={dismiss}>Cancel</PaperButton>
                    <Show when={error() && !locations()} fallback={
                        <PaperButton disabled={saving() || !selected()} onClick={() => void choose()}>{saving() ? "Saving..." : "Use this location"}</PaperButton>
                    }>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </Show>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="body">This panel's files and settings are copied here each time it makes a backup.</PaperText>
                <Show when={locations()} fallback={<Show when={!error()}><PaperText size={2} color="text-subtle">Loading locations…</PaperText></Show>}>
                    {(list) => (
                        <PaperSelector name="backup-location" value={selected()} onValueChange={(value) => setSelected(String(value))}>
                            <For each={list()}>
                                {(location) => (
                                    <PaperSelectorItem value={location.id} icon={<LocationLogo kind={location.kind} />} description={`${location.detail}. ${usageText(usage()[location.id] ?? { kind: "loading" })}`}>
                                        {backupLocationLabel(location, props.computerName)}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    )}
                </Show>
                <PaperText size={2} color="text-subtle">Add Google Drive or an S3 bucket in {props.computerName}'s Computer Info.</PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default BackupLocationChooser;
