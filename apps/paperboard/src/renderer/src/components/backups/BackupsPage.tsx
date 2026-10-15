import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { PaperButton, PaperCheckbox, PaperFlex, PaperInput, PaperModal, PaperSettingItem, PaperText } from "@mileniumhq/paperui";
import { backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { isBrowserShell, shellIpc } from "../../lib/shell";
import { loadUsage, usageText, type UsageState } from "./locationUsage";

type Form = "s3" | "gdrive" | null;

const S3_FIELDS = [
    ["label", "Name", "Offsite bucket"],
    ["endpoint", "Endpoint", "https://s3.us-east-1.amazonaws.com"],
    ["region", "Region", "us-east-1"],
    ["bucket", "Bucket", "my-backups"],
    ["prefix", "Folder in the bucket (optional)", "paperboard"],
    ["accessKeyId", "Access key ID", ""],
    ["secretAccessKey", "Secret access key", ""],
] as const;

const DRIVE_FIELDS = [
    ["label", "Name", "Google Drive"],
    ["clientId", "OAuth client ID", "….apps.googleusercontent.com"],
    ["clientSecret", "OAuth client secret", ""],
] as const;

// A computer's backup locations, in its settings: what each holds and has
// free, adding an S3 bucket or Google Drive, and removing one. Removing a
// location keeps the backups already there.
const BackupLocationsSettings: Component<{ computerId: string }> = (props) => {
    const [locations, setLocations] = createSignal<BackupLocation[] | null>(null);
    const [usage, setUsage] = createSignal<Record<string, UsageState>>({});
    const [loadError, setLoadError] = createSignal("");
    const [form, setForm] = createSignal<Form>(null);
    const [values, setValues] = createSignal<Record<string, string>>({});
    const [pathStyle, setPathStyle] = createSignal(false);
    const [busy, setBusy] = createSignal(false);
    const [formError, setFormError] = createSignal("");
    const [removing, setRemoving] = createSignal<BackupLocation | null>(null);

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

    const open = (kind: Form) => {
        setValues({});
        setPathStyle(false);
        setFormError("");
        setForm(kind);
    };

    const add = async () => {
        setBusy(true);
        setFormError("");
        try {
            const v = values();
            if (form() === "s3") {
                await backupLocationsApi.add(
                    { kind: "s3", label: v.label ?? "", endpoint: v.endpoint ?? "", region: v.region ?? "", bucket: v.bucket ?? "", prefix: v.prefix ?? "", accessKeyId: v.accessKeyId ?? "", secretAccessKey: v.secretAccessKey ?? "", pathStyle: pathStyle() },
                    props.computerId,
                );
            } else {
                await shellIpc().invoke("backup-gdrive-connect", { computerId: props.computerId, label: v.label ?? "", clientId: v.clientId ?? "", clientSecret: v.clientSecret ?? "" });
            }
            setForm(null);
            await load();
        } catch (err) {
            setFormError((err as Error)?.message ?? String(err));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const target = removing();
        if (!target) return;
        setBusy(true);
        setFormError("");
        try {
            await backupLocationsApi.remove(target.id, props.computerId);
            setRemoving(null);
            await load();
        } catch (err) {
            setFormError((err as Error)?.message ?? String(err));
        } finally {
            setBusy(false);
        }
    };

    const fields = () => (form() === "s3" ? S3_FIELDS : DRIVE_FIELDS);

    return (
        <>
            <PaperSettingItem title="Backup Locations" description="Where this computer's panels can keep their backups">
                <PaperFlex direction="column" gap="half">
                    <Show when={loadError()}>
                        <PaperText size={2} color="danger">{loadError()}</PaperText>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </Show>
                    <For each={locations() ?? []}>
                        {(location) => (
                            <PaperFlex direction="row" gap="half" align="center" justify="space-between">
                                <PaperFlex direction="column">
                                    <PaperText size={3} weight={600}>{location.label}</PaperText>
                                    <PaperText size={2} color="text-subtle">{location.detail}. {usageText(usage()[location.id] ?? { kind: "loading" })}</PaperText>
                                </PaperFlex>
                                <Show when={location.removable}>
                                    <PaperButton variant="text" onClick={() => { setFormError(""); setRemoving(location); }}>Remove</PaperButton>
                                </Show>
                            </PaperFlex>
                        )}
                    </For>
                    <PaperFlex direction="row" gap="half">
                        <PaperButton onClick={() => open("s3")}>Add S3 Bucket</PaperButton>
                        <PaperButton disabled={isBrowserShell()} title={isBrowserShell() ? "Connect Google Drive from the Paperboard app" : undefined} onClick={() => open("gdrive")}>
                            Connect Google Drive
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperSettingItem>

            <PaperModal
                open={form() !== null}
                onClose={() => !busy() && setForm(null)}
                title={form() === "s3" ? "Add S3 Bucket" : "Connect Google Drive"}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton variant="text" disabled={busy()} onClick={() => setForm(null)}>Cancel</PaperButton>
                        <PaperButton disabled={busy()} onClick={() => void add()}>
                            {busy() ? (form() === "s3" ? "Checking..." : "Waiting for Google...") : form() === "s3" ? "Add Bucket" : "Sign In With Google"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <Show when={form() === "gdrive"}>
                        <PaperText size={2} color="text-subtle">
                            Use a Desktop app OAuth client from your Google Cloud project. Paperboard opens Google's sign-in in your browser and keeps backups in a "Paperboard Backups" folder, the only files it can see.
                        </PaperText>
                    </Show>
                    <For each={fields()}>
                        {([key, label, placeholder]) => (
                            <PaperInput
                                fullWidth
                                aria-label={label}
                                placeholder={placeholder || label}
                                type={key === "secretAccessKey" || key === "clientSecret" ? "password" : "text"}
                                value={values()[key] ?? ""}
                                onInput={(e) => setValues((prev) => ({ ...prev, [key]: e.currentTarget.value }))}
                            />
                        )}
                    </For>
                    <Show when={form() === "s3"}>
                        <PaperCheckbox checked={pathStyle()} onChange={setPathStyle} label="Path-style addresses" description="For MinIO and other servers that do not take the bucket as a subdomain" />
                    </Show>
                    <Show when={formError()}>
                        <PaperText size={2} color="danger">{formError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={removing() !== null}
                onClose={() => !busy() && setRemoving(null)}
                title="Remove Backup Location"
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton variant="text" disabled={busy()} onClick={() => setRemoving(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={busy()} onClick={() => void remove()}>{busy() ? "Removing..." : "Remove"}</PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Remove <strong>{removing()?.label}</strong>? Panels using it stop making backups until you choose another location. Backups already there are not deleted.
                    </PaperText>
                    <Show when={formError()}>
                        <PaperText size={2} color="danger">{formError()}</PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
};

export default BackupLocationsSettings;
