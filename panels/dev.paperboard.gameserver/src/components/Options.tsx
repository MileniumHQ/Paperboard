import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@mileniumhq/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { serverBridge } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import {
    defaultValueFor,
    readServerPropertiesStrict,
    visiblePropertyFields,
    writeServerProperties,
    type PropertyField,
} from "../lib/properties";
import { errorMessage } from "../lib/failure";

const SAVE_DEBOUNCE_MS = 400;

export default function Options() {
    const [values, setValues] = createSignal<Record<string, string> | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    // keys edited since the last successful save; only these are offered for
    // live application so an unrelated edit doesn't re-issue commands
    const dirty = new Set<string>();

    // an unreadable file shows the error, never a form of defaults: saving
    // that form would write the defaults over the real settings
    const load = async () => {
        setLoadError("");
        try {
            const props = await readServerPropertiesStrict();
            const next: Record<string, string> = {};
            for (const field of visiblePropertyFields()) {
                next[field.key] = props[field.key] ?? defaultValueFor(field);
            }
            setValues(next);
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    onMount(() => void load());

    onCleanup(() => {
        // a debounced edit made just before leaving the tab must not be
        // dropped: flush it instead of cancelling it
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            void persistChanges();
        }
    });

    const currentValue = (field: PropertyField) =>
        values()?.[field.key] ?? defaultValueFor(field);

    const updateValue = (field: PropertyField, value: string) => {
        if (field.control === "number") {
            if (value.trim() === "") return;
            const num = Number(value);
            if (!Number.isFinite(num)) return;
            if (field.min !== undefined && num < field.min) return;
            if (field.max !== undefined && num > field.max) return;
        }
        setValues((prev) => ({ ...(prev ?? {}), [field.key]: value }));
        dirty.add(field.key);
        scheduleSave();
    };

    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void persistChanges(), SAVE_DEBOUNCE_MS);
    };

    const persistChanges = async () => {
        const snapshot = values();
        if (!snapshot) return;
        const changed: Record<string, string> = {};
        for (const key of dirty) {
            if (snapshot[key] !== undefined) changed[key] = snapshot[key];
        }
        // a gamemode change needs the current force-gamemode to decide
        // whether to also force online players
        if (changed.gamemode !== undefined) {
            changed["force-gamemode"] = snapshot["force-gamemode"] ?? "false";
        }
        try {
            await writeServerProperties(snapshot);
            // difficulty/gamemode are per-world (level.dat); apply the edited
            // ones to a running server live, or queue them for the next start
            if (Object.keys(changed).length > 0) {
                await serverBridge.call(ACTION_IDS.applyRuntimeProperties, {
                    values: changed,
                });
            }
            dirty.clear();
            setSaveError("");
        } catch (err) {
            setSaveError(errorMessage(err));
        }
    };

    const renderControl = (field: PropertyField) => (
        <FieldControl
            field={field}
            value={() => currentValue(field)}
            onUpdate={(value) => updateValue(field, value)}
        />
    );

    return (
        <>
            <PaperPageHeader icon="tune" title="Options" />
            <PaperQuote variant="warning" icon="info" title="When changes apply">
                World generation, network and whitelist settings apply after a restart. Difficulty and game mode apply immediately while the server is running.
            </PaperQuote>
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read server.properties">
                    <PaperFlex direction="column" gap="half">
                        <PaperText>{loadError()}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="Options not saved">
                    {saveError()}
                </PaperQuote>
            </Show>
            <Show
                when={values()}
                fallback={
                    <Show when={!loadError()}>
                        <PaperText size={2} color="text-subtle">Loading settings…</PaperText>
                    </Show>
                }
            >
                <PaperSettingList autoHeight>
                    <For each={visiblePropertyFields()}>
                        {(field) => (
                            <PaperSettingItem title={field.title} description={field.description}>
                                {renderControl(field)}
                            </PaperSettingItem>
                        )}
                    </For>
                </PaperSettingList>
            </Show>
        </>
    );
}
