import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperModal, PaperSectionHeader, PaperText, getVarCss } from "@mileniumhq/paperui";
import { backupLocationLabel, backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { loadUsage, usageText, type UsageState } from "./locationUsage";
import { LocationLogo } from "./providers";
import AddLocationModal from "./AddLocationModal";

// The Backups section of a computer's Computer Info: the locations its
// panels can keep backups in, what each holds and has free, adding one, and
// removing one. Removing a location keeps the backups already there.
const BackupLocations: Component<{ computerId: string; computerName: string }> = (props) => {
    const [locations, setLocations] = createSignal<BackupLocation[] | null>(null);
    const [usage, setUsage] = createSignal<Record<string, UsageState>>({});
    const [loadError, setLoadError] = createSignal("");
    const [adding, setAdding] = createSignal(false);
    const [removing, setRemoving] = createSignal<BackupLocation | null>(null);
    const [removeBusy, setRemoveBusy] = createSignal(false);
    const [removeError, setRemoveError] = createSignal("");

    const load = async () => {
        setLoadError("");
        try {
            const list = await backupLocationsApi.list(props.computerId);
            setLocations(list);
            for (const location of list) {
                setUsage((prev) => ({ ...prev, [location.id]: { kind: "loading" } }));
                void loadUsage(location.id, props.computerId).then((state) => setUsage((prev) => ({ ...prev, [location.id]: state })));
            }
        } catch (err) {
            setLocations(null);
            setLoadError(`Backup locations could not be loaded: ${(err as Error)?.message ?? err}`);
        }
    };
    onMount(() => void load());

    const remove = async () => {
        const target = removing();
        if (!target) return;
        setRemoveBusy(true);
        setRemoveError("");
        try {
            await backupLocationsApi.remove(target.id, props.computerId);
            setRemoving(null);
            await load();
        } catch (err) {
            setRemoveError((err as Error)?.message ?? String(err));
        } finally {
            setRemoveBusy(false);
        }
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperSectionHeader icon="backup" title="Backups">
                <PaperButton size="small" onClick={() => setAdding(true)}>Add Location</PaperButton>
            </PaperSectionHeader>

            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={loadError()}>
                    <PaperCard accent="danger" padding="full">
                        <PaperFlex direction="row" gap="full" align="center" justify="space-between">
                            <PaperText size={2} color="danger">{loadError()}</PaperText>
                            <PaperButton onClick={() => void load()}>Try Again</PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </Show>
                <Show when={!locations() && !loadError()}>
                    <PaperText size={2} color="text-subtle">Loading locations…</PaperText>
                </Show>
                <For each={locations() ?? []}>
                    {(location) => (
                        <PaperCard surface="front" padding="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <span
                                    style={{
                                        display: "inline-flex",
                                        padding: getVarCss("uigap-threefourths"),
                                        "border-radius": getVarCss("border-radius"),
                                        background: getVarCss("surface-inset"),
                                    }}
                                >
                                    <LocationLogo kind={location.kind} size="large" />
                                </span>
                                <PaperFlex direction="column" style={{ flex: 1, "min-width": 0 }}>
                                    <PaperText size={3} weight={700} truncate>{backupLocationLabel(location, props.computerName)}</PaperText>
                                    <PaperText size={2} color="text-subtle" truncate>{location.detail}</PaperText>
                                    <PaperText size={2} color={usage()[location.id]?.kind === "failed" ? "danger" : "text-subtle"}>
                                        {usageText(usage()[location.id] ?? { kind: "loading" })}
                                    </PaperText>
                                </PaperFlex>
                                <Show when={location.removable}>
                                    <PaperButton variant="text" onClick={() => { setRemoveError(""); setRemoving(location); }}>Remove</PaperButton>
                                </Show>
                            </PaperFlex>
                        </PaperCard>
                    )}
                </For>
                <PaperText size={2} color="text-subtle">
                    A panel asks where to keep its backups the first time it makes one. Its later backups go to the same place.
                </PaperText>
            </PaperFlex>

            <AddLocationModal
                computerId={props.computerId}
                takenLabels={(locations() ?? []).map((location) => backupLocationLabel(location, props.computerName))}
                open={adding()} onClose={() => setAdding(false)} onAdded={() => void load()} />

            <PaperModal
                open={removing() !== null}
                onClose={() => !removeBusy() && setRemoving(null)}
                title="Remove Backup Location"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton variant="text" disabled={removeBusy()} onClick={() => setRemoving(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={removeBusy()} onClick={() => void remove()}>{removeBusy() ? "Removing..." : "Remove"}</PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Remove <strong>{removing()?.label}</strong>? Panels using it stop making backups until you choose another location. Backups already there are not deleted.
                    </PaperText>
                    <Show when={removeError()}>
                        <PaperText size={2} color="danger">{removeError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
    );
};

export default BackupLocations;
