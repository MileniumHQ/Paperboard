import { type Component, createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperCard, PaperEmptyState, PaperFlex, PaperModal, PaperSectionHeader, PaperText, createAction, createFailureToast, createLatest, createRead } from "@mileniumhq/paperui";
import { backupLocationLabel, backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { isBrowserShell, shellIpc } from "../../lib/shell";
import { createLocationUsage, usageText } from "./locationUsage";
import { LocationLogo } from "./providers";
import AddLocationModal from "./AddLocationModal";
import styles from "./BackupLocations.module.css";

// The Backups section of a computer's Computer Info: the locations its
// panels can keep backups in, what each holds and has free, adding one, and
// removing one. Removing a location keeps the backups already there.
const BackupLocations: Component<{ computerId: string; computerName: string; shown: boolean }> = (props) => {
    // reconciled by id: a reload keeps each card, and its space line, as it is.
    // A damaged locations file is no list: it is shown with its own recovery action.
    const read = createRead(
        async (): Promise<{ problem: string } | { locations: BackupLocation[] }> => {
            const damaged = await backupLocationsApi.problem(props.computerId);
            return damaged ? { problem: damaged } : { locations: await backupLocationsApi.list(props.computerId) };
        },
        { failure: { title: "Couldn't load backup locations", retry: true } },
    );
    const now = () => (read.error() ? undefined : read.value());
    const locations = () => {
        const shown = now();
        return shown && "locations" in shown ? shown.locations : null;
    };
    const problem = () => {
        const shown = now();
        return shown && "problem" in shown ? shown.problem : "";
    };
    createFailureToast(problem, { title: "The backup locations file is damaged" });
    // each location's space is read again with every reload; it keeps the space it showed until its new answer is in
    const [round, setRound] = createSignal(0);
    const load = () => {
        setRound((n) => n + 1);
        return read.reload();
    };
    // the page stays mounted while hidden: what a panel backed up meanwhile is counted as it comes back into view
    createEffect(on(() => props.shown, (shown) => {
        if (shown) void load();
    }, { defer: true }));
    const recovery = createAction();
    const recovering = recovery.busy;
    const [adding, setAdding] = createSignal(false);
    const [removing, setRemoving] = createSignal<BackupLocation | null>(null);
    const removal = createAction();
    const removeBusy = removal.busy;

    // signing a Google Drive location in again keeps its folder and backups
    const [reconnecting, setReconnecting] = createSignal<string | null>(null);
    const reconnection = createAction();
    // a reconnect that was canceled drops its answer
    const reconnects = createLatest();
    const reconnect = async (location: BackupLocation) => {
        const current = reconnects();
        setReconnecting(location.id);
        await reconnection.run(`${location.label} couldn't be reconnected`, async () => {
            try {
                await shellIpc().invoke("backup-gdrive-connect", { computerId: props.computerId, locationId: location.id });
                if (current()) await load();
            } catch (err) {
                if (current()) throw err;
            }
        });
        if (current()) setReconnecting(null);
    };
    const cancelReconnect = async () => {
        reconnects.cancel();
        setReconnecting(null);
        await reconnection.run("The sign-in could not be canceled", () => shellIpc().invoke("backup-gdrive-cancel"));
    };

    const recover = () =>
        recovery.run("The damaged locations file could not be set aside", async () => {
            await backupLocationsApi.recover(props.computerId);
            await load();
        });

    const remove = async () => {
        const target = removing();
        if (!target) return;
        await removal.run(`Couldn't remove ${target.label}`, async () => {
            await backupLocationsApi.remove(target.id, props.computerId);
            setRemoving(null);
            await load();
        });
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperSectionHeader icon="backup" title="Backups">
                <PaperButton size="small" disabled={Boolean(problem())} onClick={() => setAdding(true)}>Add Location</PaperButton>
            </PaperSectionHeader>

            <PaperFlex direction="column" gap="full" fullWidth>
                <Show when={read.error()}>
                    <PaperEmptyState icon="error" title="Couldn't load">
                        <PaperButton disabled={read.loading()} onClick={() => void load()}>Try again</PaperButton>
                    </PaperEmptyState>
                </Show>
                <Show when={problem()}>
                    <PaperEmptyState
                        icon="error"
                        title="Couldn't load"
                        description="Starting fresh keeps the damaged file beside it and empties this list. Panels choose a location again; backups already at your locations are not deleted."
                    >
                        <PaperButton variant="danger" disabled={recovering()} onClick={() => void recover()}>
                            {recovering() ? "Setting Aside..." : "Set Aside and Start Fresh"}
                        </PaperButton>
                        <PaperButton variant="text" disabled={recovering()} onClick={() => void load()}>Try again</PaperButton>
                    </PaperEmptyState>
                </Show>
                <Show when={!read.value() && !read.error()}>
                    <PaperText preset="hint" inset>Loading locations…</PaperText>
                </Show>
                <For each={locations() ?? []}>
                    {(location) => {
                        const usage = createLocationUsage(location.id, props.computerId, round);
                        return (
                            <PaperCard surface="front" padding="inset">
                                <PaperFlex direction="row" gap="full" align="center">
                                    <span class={styles.logoTile}>
                                        <LocationLogo kind={location.kind} size="large" />
                                    </span>
                                    <PaperFlex direction="column" flex={1} minWidth={0}>
                                        <PaperText preset="label" truncate>{backupLocationLabel(location, props.computerName)}</PaperText>
                                        <PaperText preset="hint" truncate>{location.detail}</PaperText>
                                        <PaperText preset="hint">{usageText(usage)}</PaperText>
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
                                        <PaperButton variant="text" onClick={() => setRemoving(location)}>Remove</PaperButton>
                                    </Show>
                                </PaperFlex>
                            </PaperCard>
                        );
                    }}
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
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
    );
};

export default BackupLocations;
