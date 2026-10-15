import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperFlex, PaperModal, PaperSelector, PaperSelectorItem, PaperText } from "@mileniumhq/paperui";
import { backupApi, backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { loadUsage, usageText, type UsageState } from "./locationUsage";
import { LocationLogo } from "./providers";

export type BackupLocationChoice = { status: "chosen"; location: BackupLocation } | { status: "canceled" } | { status: "failed"; message: string };

// The window a panel opens with backupApi.chooseLocation: the computer's
// backup locations with how much space each has, and which one this
// panel's backups go to. Only the shell sets the choice.
const BackupLocationChooser: Component<{ computerId: string; panelId: string; onDone: (choice: BackupLocationChoice) => void }> = (props) => {
    const [locations, setLocations] = createSignal<BackupLocation[] | null>(null);
    const [usage, setUsage] = createSignal<Record<string, UsageState>>({});
    const [selected, setSelected] = createSignal("");
    const [error, setError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    let done = false;
    const finish = (choice: BackupLocationChoice) => {
        if (done) return;
        done = true;
        props.onDone(choice);
    };

    const load = async () => {
        setError("");
        setLocations(null);
        try {
            const [list, status] = await Promise.all([backupLocationsApi.list(props.computerId), backupApi.status(props.panelId, props.computerId)]);
            setLocations(list);
            setSelected(status.location?.id ?? list[0]?.id ?? "");
            for (const location of list) {
                setUsage((prev) => ({ ...prev, [location.id]: { kind: "loading" } }));
                void loadUsage(location.id, props.computerId).then((state) => setUsage((prev) => ({ ...prev, [location.id]: state })));
            }
        } catch (err) {
            setError(`Backup locations could not be loaded: ${(err as Error)?.message ?? err}`);
        }
    };
    onMount(() => void load());

    const choose = async () => {
        setSaving(true);
        setError("");
        try {
            const status = await backupLocationsApi.setForPanel(props.panelId, selected(), props.computerId);
            if (!status.location) throw new Error("The computer did not keep the choice");
            finish({ status: "chosen", location: status.location });
        } catch (err) {
            setError((err as Error)?.message ?? String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperModal
            open
            title="Where should backups go?"
            size="small"
            onClose={() => finish({ status: "canceled" })}
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton variant="text" disabled={saving()} onClick={() => finish({ status: "canceled" })}>Cancel</PaperButton>
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
                                        {location.label}
                                    </PaperSelectorItem>
                                )}
                            </For>
                        </PaperSelector>
                    )}
                </Show>
                <PaperText size={2} color="text-subtle">Add Google Drive or an S3 bucket in this computer's Computer Info.</PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default BackupLocationChooser;
