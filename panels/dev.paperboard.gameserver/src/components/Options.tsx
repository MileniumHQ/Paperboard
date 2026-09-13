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
import {
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

    onMount(async () => {
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of visiblePropertyFields()) {
            next[field.key] = props[field.key] ?? field.defaultValue;
        }
        setValues(next);
    });

    onCleanup(() => {
        if (saveTimer) clearTimeout(saveTimer);
    });

    const currentValue = (field: PropertyField) =>
        values()?.[field.key] ?? field.defaultValue;

    const updateValue = (field: PropertyField, value: string) => {
        if (field.control === "number") {
            if (value.trim() === "") return;
            const num = Number(value);
            if (!Number.isFinite(num)) return;
            if (field.min !== undefined && num < field.min) return;
            if (field.max !== undefined && num > field.max) return;
        }
        setValues((prev) => ({ ...(prev ?? {}), [field.key]: value }));
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
        <PaperFlex direction="column" fullWidth fullHeight style={{ "min-height": 0 }}>
            <div class="gs-scroll">
                <div class="gs-page">
                    <PaperPageHeader icon="tune" title="Options" />
                    <div class="gs-surface">
                        <PaperSettingList autoHeight>
                            <PaperFlex padding="full" gap="half">
                                <PaperQuote variant="yellow" icon="warning" title="Note">
                                    Changes won't be applied until the server is restarted.
                                </PaperQuote>
                                <Show when={saveError()}>
                                    <PaperQuote variant="red" icon="warning" title="Error">
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
                    </div>
                </div>
            </div>
        </PaperFlex>
    );
}
