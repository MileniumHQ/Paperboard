import { type Component, createEffect, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperCheckbox, PaperFlex, PaperInput, PaperModal, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import { isBrowserShell } from "../../lib/shell";
import { BACKUP_PROVIDERS, LocationLogo, type BackupProvider } from "./providers";

// Adding a backup location: pick a provider from the dropdown, then fill in
// that provider's form. The location is added on the computer, which checks
// it can reach it before keeping it.
const AddLocationModal: Component<{ computerId: string; open: boolean; onClose: () => void; onAdded: () => void }> = (props) => {
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

    const close = () => {
        if (!busy()) props.onClose();
    };

    const submit = async () => {
        setBusy(true);
        setError("");
        try {
            await provider().connect(values(), toggles(), props.computerId);
            setBusy(false);
            close();
            props.onAdded();
        } catch (err) {
            setError((err as Error)?.message ?? String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={close}
            title="Add Backup Location"
            size="small"
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton variant="text" disabled={busy()} onClick={close}>Cancel</PaperButton>
                    <PaperButton disabled={busy() || blocked()} onClick={() => void submit()}>
                        {busy() ? provider().busyLabel : provider().submitLabel}
                    </PaperButton>
                </PaperFlex>
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
                    {(intro) => <PaperText size={2} color="text-subtle">{intro()}</PaperText>}
                </Show>
                <Show when={blocked()}>
                    <PaperText size={2} color="warning">Connect {provider().name} from the Paperboard app. Browser mode cannot open its sign-in.</PaperText>
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
                    <PaperText size={2} color="danger">{error()}</PaperText>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
};

export default AddLocationModal;
