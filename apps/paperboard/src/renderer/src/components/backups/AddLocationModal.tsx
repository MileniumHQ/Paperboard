import { type Component, createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperCheckbox, PaperFlex, PaperInput, PaperModal, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import { isBrowserShell } from "../../lib/shell";
import { BACKUP_PROVIDERS, LocationLogo, type BackupProvider } from "./providers";
import { uniqueLocationLabel } from "./locationLabel";
import { errorMessage } from "@mileniumhq/paperapi";

// Adding a backup location: pick a provider from the dropdown, then fill in
// that provider's form. The location is added on the computer, which checks
// it can reach it before keeping it.
const AddLocationModal: Component<{
    computerId: string;
    /** the computer's location names, so an unnamed one gets a name of its own */
    takenLabels: readonly string[];
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
}> = (props) => {
    const [kind, setKind] = createSignal<BackupProvider["kind"]>(BACKUP_PROVIDERS[0].kind);
    const [values, setValues] = createSignal<Record<string, string>>({});
    const [toggles, setToggles] = createSignal<Record<string, boolean>>({});
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");

    const provider = () => BACKUP_PROVIDERS.find((p) => p.kind === kind()) ?? BACKUP_PROVIDERS[0];
    const blocked = () => Boolean(provider().needsDesktopApp && isBrowserShell());

    const choose = (next: BackupProvider["kind"]) => {
        setKind(next);
        setValues({});
        setToggles({});
        setError("");
    };

    // a fresh form each time the window opens; resetting on close would
    // swap the form while the window animates out
    createEffect(on(() => props.open, (open) => open && choose(BACKUP_PROVIDERS[0].kind)));

    // a connect that was canceled drops its answer
    let attempt = 0;

    // while a connect waits on the person, closing cancels it if its provider can
    const close = () => {
        if (!busy()) return props.onClose();
        const cancel = provider().cancel;
        if (!cancel) return;
        attempt++;
        setBusy(false);
        cancel().then(
            () => props.onClose(),
            (err) => setError(`The sign-in could not be canceled: ${errorMessage(err)}`),
        );
    };

    const submit = async () => {
        const mine = ++attempt;
        setBusy(true);
        setError("");
        try {
            const chosen = provider();
            const named = chosen.defaultLabel ? { label: uniqueLocationLabel(chosen.defaultLabel, props.takenLabels), ...values() } : values();
            await chosen.connect(named, toggles(), props.computerId);
            if (mine !== attempt) return;
            setBusy(false);
            close();
            props.onAdded();
        } catch (err) {
            if (mine === attempt) setError(errorMessage(err));
        } finally {
            if (mine === attempt) setBusy(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={close}
            title="Add Backup Location"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" disabled={busy() && !provider().cancel} onClick={close}>Cancel</PaperButton>
                    <PaperButton disabled={busy() || blocked()} onClick={() => void submit()}>
                        {busy() ? provider().busyLabel : provider().submitLabel}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="full">
                <PaperSelectMenu name="backup-provider" value={kind()} onValueChange={(value) => choose(String(value) as BackupProvider["kind"])} disabled={busy()} fullWidth>
                    <For each={BACKUP_PROVIDERS}>
                        {(option) => (
                            <PaperSelectMenuItem value={option.kind} icon={<LocationLogo kind={option.kind} />} description={option.description}>
                                {option.name}
                            </PaperSelectMenuItem>
                        )}
                    </For>
                </PaperSelectMenu>
                <Show when={provider().intro}>
                    {(intro) => <PaperText preset="text">{intro()}</PaperText>}
                </Show>
                <Show when={blocked()}>
                    <PaperText preset="hint" color="warning">Connect {provider().name} from the Paperboard app. Its sign-in can't open in browser mode.</PaperText>
                </Show>
                <For each={provider().fields}>
                    {(field) => (
                        <PaperInput
                            fullWidth
                            label={field.label}
                            placeholder={field.placeholder}
                            type={field.secret ? "password" : "text"}
                            autocomplete="off"
                            disabled={busy()}
                            value={values()[field.key] ?? ""}
                            onInput={(e) => setValues((prev) => ({ ...prev, [field.key]: e.currentTarget.value }))}
                        />
                    )}
                </For>
                <For each={provider().toggles ?? []}>
                    {(toggle) => (
                        <PaperCheckbox
                            checked={Boolean(toggles()[toggle.key])}
                            onChange={(checked: boolean) => setToggles((prev) => ({ ...prev, [toggle.key]: checked }))}
                            label={toggle.label}
                            description={toggle.description}
                        />
                    )}
                </For>
                <Show when={error()}>
                    <PaperText preset="error">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default AddLocationModal;
