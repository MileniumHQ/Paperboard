import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperCard, PaperFlex, PaperModal, PaperSectionHeader, PaperText, createLatest } from "@mileniumhq/paperui";
import { backupLocationLabel, backupLocationsApi, type BackupLocation, errorMessage } from "@mileniumhq/paperapi";
import { isBrowserShell, shellIpc } from "../../lib/shell";
import { loadUsage, usageText, type UsageState } from "./locationUsage";
import { LocationLogo } from "./providers";
import AddLocationModal from "./AddLocationModal";
import styles from "./BackupLocations.module.css";

// The Backups section of a computer's Computer Info: the locations its
// panels can keep backups in, what each holds and has free, adding one, and
// removing one. Removing a location keeps the backups already there.
const BackupLocations: Component<{ computerId: string; computerName: string }> = (props) => {
    // reconciled by id: a reload keeps each card, and its space line, as it is
    const [state, setState] = createStore<{ locations: BackupLocation[] | null }>({ locations: null });
    const locations = () => state.locations;
    const setLocations = (list: BackupLocation[] | null) => setState("locations", list ? reconcile(list, { key: "id" }) : null);
    const [usage, setUsage] = createSignal<Record<string, UsageState>>({});
    const [loadError, setLoadError] = createSignal("");
    // the locations file is damaged: shown with its own recovery action
    const [problem, setProblem] = createSignal("");
    const [recovering, setRecovering] = createSignal(false);
    const [adding, setAdding] = createSignal(false);
    const [removing, setRemoving] = createSignal<BackupLocation | null>(null);
    const [removeBusy, setRemoveBusy] = createSignal(false);
    const [removeError, setRemoveError] = createSignal("");

    // a newer load (after an add, a remove, a reconnect) wins over an older one still out
    const latest = createLatest();
    const load = async () => {
        const current = latest();
        setLoadError("");
        setProblem("");
        try {
            const damaged = await backupLocationsApi.problem(props.computerId);
            if (!current()) return;
            if (damaged) {
                setLocations(null);
                setProblem(damaged);
                return;
            }
            const list = await backupLocationsApi.list(props.computerId);
            if (!current()) return;
            setLocations(list);
            // a location keeps the space it showed until its new answer is in
            for (const location of list) {
                void loadUsage(location.id, props.computerId).then((usage) => {
                    if (current()) setUsage((prev) => ({ ...prev, [location.id]: usage }));
                });
            }
        } catch (err) {
            if (!current()) return;
            setLocations(null);
            setLoadError(`Backup locations could not be loaded: ${errorMessage(err)}`);
        }
    };
    onMount(() => void load());

    // signing a Google Drive location in again keeps its folder and backups
    const [reconnecting, setReconnecting] = createSignal<string | null>(null);
    const [reconnectError, setReconnectError] = createSignal("");
    // a reconnect that was canceled drops its answer
    let reconnects = 0;
    const reconnect = async (location: BackupLocation) => {
        const mine = ++reconnects;
        setReconnecting(location.id);
        setReconnectError("");
        try {
            await shellIpc().invoke("backup-gdrive-connect", { computerId: props.computerId, locationId: location.id });
            if (mine === reconnects) await load();
        } catch (err) {
            if (mine === reconnects) setReconnectError(`${location.label} could not be reconnected: ${errorMessage(err)}`);
        } finally {
            if (mine === reconnects) setReconnecting(null);
        }
    };
    const cancelReconnect = async () => {
        reconnects++;
        setReconnecting(null);
        try {
            await shellIpc().invoke("backup-gdrive-cancel");
        } catch (err) {
            setReconnectError(`The sign-in could not be canceled: ${errorMessage(err)}`);
        }
    };

    const recover = async () => {
        setRecovering(true);
        try {
            await backupLocationsApi.recover(props.computerId);
            await load();
        } catch (err) {
            setProblem(`The damaged locations file could not be set aside: ${errorMessage(err)}`);
        } finally {
            setRecovering(false);
        }
    };

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
            setRemoveError(errorMessage(err));
        } finally {
            setRemoveBusy(false);
        }
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperSectionHeader icon="backup" title="Backups">
                <PaperButton size="small" disabled={Boolean(problem())} onClick={() => setAdding(true)}>Add Location</PaperButton>
            </PaperSectionHeader>

            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={loadError()}>
                    <PaperCard accent="danger" padding="inset">
                        <PaperFlex direction="row" gap="full" align="center" justify="space-between">
                            <PaperText preset="error">{loadError()}</PaperText>
                            <PaperButton onClick={() => void load()}>Try Again</PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </Show>
                <Show when={problem()}>
                    <PaperCard accent="danger" padding="inset">
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="error">{problem()}</PaperText>
                            <PaperText preset="hint">
                                Starting fresh keeps the damaged file beside it and empties this list. Panels choose a location again; backups already at your locations are not deleted.
                            </PaperText>
                            <PaperFlex direction="row" gap="half">
                                <PaperButton variant="danger" disabled={recovering()} onClick={() => void recover()}>
                                    {recovering() ? "Setting Aside..." : "Set Aside and Start Fresh"}
                                </PaperButton>
                                <PaperButton variant="text" disabled={recovering()} onClick={() => void load()}>Try Again</PaperButton>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperCard>
                </Show>
                <Show when={!locations() && !loadError() && !problem()}>
                    <PaperText preset="hint" inset>Loading locations…</PaperText>
                </Show>
                <Show when={reconnectError()}>
                    <PaperText preset="error" inset>{reconnectError()}</PaperText>
                </Show>
                <For each={locations() ?? []}>
                    {(location) => (
                        <PaperCard surface="front" padding="inset">
                            <PaperFlex direction="row" gap="full" align="center">
                                <span class={styles.logoTile}>
                                    <LocationLogo kind={location.kind} size="large" />
                                </span>
                                <PaperFlex direction="column" flex={1} minWidth={0}>
                                    <PaperText preset="label" truncate>{backupLocationLabel(location, props.computerName)}</PaperText>
                                    <PaperText preset="hint" truncate>{location.detail}</PaperText>
                                    <PaperText preset={usage()[location.id]?.kind === "failed" ? "error" : "hint"}>
                                        {usageText(usage()[location.id] ?? { kind: "loading" })}
                                    </PaperText>
                                </PaperFlex>
                                <Show when={location.kind === "gdrive"}>
                                    <PaperButton
                                        variant="text"
                                        disabled={reconnecting() !== null || isBrowserShell()}
                                        onClick={() => void reconnect(location)}
                                    >
                                        {reconnecting() === location.id ? "Waiting for Google..." : "Reconnect"}
                                    </PaperButton>
                                </Show>
                                <Show when={reconnecting() === location.id}>
                                    <PaperButton variant="text" onClick={() => void cancelReconnect()}>Cancel</PaperButton>
                                </Show>
                                <Show when={location.removable && reconnecting() !== location.id}>
                                    <PaperButton variant="text" onClick={() => { setRemoveError(""); setRemoving(location); }}>Remove</PaperButton>
                                </Show>
                            </PaperFlex>
                        </PaperCard>
                    )}
                </For>
                <PaperText preset="hint" inset>
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
                    <>
                        <PaperButton variant="text" disabled={removeBusy()} onClick={() => setRemoving(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={removeBusy()} onClick={() => void remove()}>{removeBusy() ? "Removing..." : "Remove"}</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="text">
                        Remove <strong>{removing()?.label}</strong>? Panels using it stop making backups until you choose another location. Backups already there are not deleted.
                    </PaperText>
                    <Show when={removeError()}>
                        <PaperText preset="error">{removeError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
    );
};

export default BackupLocations;
