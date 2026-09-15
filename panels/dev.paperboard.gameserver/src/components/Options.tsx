import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@paperboard-dev/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { PaperPageHeader } from "@paperboard-dev/paperui";
import { serverBridge } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import {
    defaultValueFor,
    readServerProperties,
    visiblePropertyFields,
    writeServerProperties,
    type PropertyField,
} from "../lib/properties";

const SAVE_DEBOUNCE_MS = 400;

export default function Options() {
    const [values, setValues] = createSignal<Record<string, string> | null>(null);
    const [saveError, setSaveError] = createSignal(false);

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    // keys edited since the last successful save; only these are offered for
    // live application so an unrelated edit doesn't re-issue commands
    const dirty = new Set<string>();

    onMount(async () => {
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of visiblePropertyFields()) {
            next[field.key] = props[field.key] ?? defaultValueFor(field);
        }
        setValues(next);
    });

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
            setSaveError(false);
        } catch (err) {
            console.debug("[options] server.properties save failed:", String(err));
            setSaveError(true);
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
                        <PaperSettingList autoHeight>
                            <PaperFlex padding="full" gap="half">
                                <PaperQuote variant="warning" icon="warning" title="Note">
                                    World generation and network settings apply after a restart. Difficulty and game mode apply immediately while the server is running.
                                </PaperQuote>
                                <Show when={saveError()}>
                                    <PaperQuote variant="danger" icon="warning" title="Error">
                                        Failed to save changes. Check the console for details.
                                    </PaperQuote>
                                </Show>
                            </PaperFlex>
                            <Show when={values()} fallback={
                                <PaperSettingItem title="Loading settings...">
                                    <span />
                                </PaperSettingItem>
                            }>
                                <For each={visiblePropertyFields()}>
                                    {(field) => (
                                        <PaperSettingItem
                                            title={field.title}
                                            description={field.description}
                                        >
                                            {renderControl(field)}
                                        </PaperSettingItem>
                                    )}
                                </For>
                            </Show>
                        </PaperSettingList>
        </>
    );
}
