import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@paperboard-dev/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { readServerProperties, writeServerProperties } from "../lib/properties";
import { deleteActiveWorldDirs, WORLD_PROPERTY_FIELDS } from "../lib/worlds";
import { serverStatus } from "../lib/server";

const SAVE_DEBOUNCE_MS = 400;

export default function Worlds() {
    const [values, setValues] = createSignal<Record<string, string> | null>(null);
    const [saveError, setSaveError] = createSignal(false);

    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);
    const [deleteError, setDeleteError] = createSignal(false);
    const [deleteDone, setDeleteDone] = createSignal(false);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let deleteDoneTimer: ReturnType<typeof setTimeout> | null = null;

    onMount(async () => {
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of WORLD_PROPERTY_FIELDS) {
            next[field.key] = props[field.key] ?? field.defaultValue;
        }
        setValues(next);
    });

    onCleanup(() => {
        if (saveTimer) clearTimeout(saveTimer);
        if (deleteDoneTimer) clearTimeout(deleteDoneTimer);
    });

    const currentValue = (key: string, fallback: string) =>
        values()?.[key] ?? fallback;

    const updateValue = (key: string, value: string) => {
        setValues((prev) => ({ ...(prev ?? {}), [key]: value }));
        scheduleSave();
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persistChanges(), SAVE_DEBOUNCE_MS);
    };

    const persistChanges = async () => {
        const snapshot = values();
        if (!snapshot) return;
        try {
            await writeServerProperties(snapshot);
            setSaveError(false);
        } catch (err) {
            console.debug("[worlds] server.properties save failed:", String(err));
            setSaveError(true);
        }
    };

    const levelName = () => currentValue("level-name", "world");

    const confirmDelete = async () => {
        setConfirmOpen(false);
        setDeleting(true);
        setDeleteError(false);
        try {
            await deleteActiveWorldDirs(levelName());
            setDeleteDone(true);
            if (deleteDoneTimer) clearTimeout(deleteDoneTimer);
            deleteDoneTimer = setTimeout(() => setDeleteDone(false), 5000);
        } catch (err) {
            console.error("[Worlds] Failed to delete world directories:", err);
            setDeleteError(true);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight gap="half">
            <PaperFlex
                direction="column"
                gap="half"
                fullWidth
                padding="full"
                style={{ "flex-shrink": 0 }}
            >
                <PaperQuote variant="yellow" icon="warning" title="Note">
                    Changes will only be applied after creating a new world.
                </PaperQuote>
                <Show when={saveError()}>
                    <PaperQuote variant="red" icon="warning" title="Error">
                        Failed to save changes. Check the console for details.
                    </PaperQuote>
                </Show>
                <Show when={deleteError()}>
                    <PaperQuote variant="red" icon="warning" title="Error">
                        Failed to delete the world. Check the console for details.
                    </PaperQuote>
                </Show>
                <Show when={deleteDone()}>
                    <PaperQuote variant="green" icon="check" title="Deleted">
                        The world directories were removed.
                    </PaperQuote>
                </Show>
                <Show when={!values()}>
                    <PaperText size={3} color="light-text">
                        Loading settings...
                    </PaperText>
                </Show>
            </PaperFlex>

            <PaperSettingList style={{ flex: 1, "min-height": 0 }}>
                <Show when={values()}>
                    <For each={WORLD_PROPERTY_FIELDS}>
                        {(field) => (
                            <PaperSettingItem
                                title={field.title}
                                description={field.description}
                            >
                                <FieldControl
                                    field={field}
                                    value={() => currentValue(field.key, field.defaultValue)}
                                    onUpdate={(value) => updateValue(field.key, value)}
                                />
                            </PaperSettingItem>
                        )}
                    </For>
                </Show>

                <PaperSettingItem
                    title="Delete World"
                    description={`Removes "${levelName()}", "${levelName()}_nether" and "${levelName()}_the_end" from disk.`}
                >
                    <PaperButton
                        compact
                        variant="red"
                        disabled={deleting()}
                        onClick={() => setConfirmOpen(true)}
                    >
                        <PaperIcon>delete</PaperIcon>
                        Delete World
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal
                open={confirmOpen()}
                onClose={() => setConfirmOpen(false)}
                title={`Delete world "${levelName()}"`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton compact variant="red" onClick={confirmDelete}>
                            Delete
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This permanently removes the overworld, nether and end
                    directories of this world, including all builds and items in
                    them. This cannot be undone.
                    <Show when={serverStatus() !== "offline"}>
                        {" "}The server is currently running — stop it first to
                        avoid recreating partial files.
                    </Show>{" "}
                    A fresh world is generated on the next start.
                </PaperText>
            </PaperModal>
        </PaperFlex>
    );
}
