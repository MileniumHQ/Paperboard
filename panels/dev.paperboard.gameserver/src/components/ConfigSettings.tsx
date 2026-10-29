import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { PaperFlex, PaperQuote, PaperSettingItem, PaperSettingList, PaperText } from "@mileniumhq/paperui";
import { FieldControl } from "./PropertyFieldControl";
import type { LoaderGroupView, LoaderSettingView } from "../service/loaderSettings";
import type { PropertyField } from "../lib/properties";

const TYPED_SAVE_DEBOUNCE_MS = 500;

// Settings that live in a config file the server software owns (the Loader
// tab, Crossplay): one group per file, one validated edit sent at a time.
// Typed values wait for a pause before saving; a refused write shows its
// reason and reloads what the file actually holds.
export default function ConfigSettings(props: {
    groups: LoaderGroupView[];
    write: (id: string, value: string) => Promise<unknown>;
    reload: () => Promise<void>;
    /** one list with no file names: for a tab where the files are an implementation detail */
    plain?: boolean;
}) {
    const [values, setValues] = createSignal<Record<string, string>>({});
    const [saveError, setSaveError] = createSignal("");
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    createEffect(() => {
        const next: Record<string, string> = {};
        for (const group of props.groups) {
            for (const setting of group.settings) next[setting.id] = setting.value;
        }
        setValues(next);
    });

    const save = async (id: string, value: string) => {
        try {
            await props.write(id, value);
            setSaveError("");
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
            await props.reload();
        }
    };

    onCleanup(() => {
        // a pending edit is sent, not dropped, when leaving the tab
        for (const [id, timer] of timers) {
            clearTimeout(timer);
            void save(id, values()[id] ?? "");
        }
        timers.clear();
    });

    const update = (setting: LoaderSettingView, value: string) => {
        if (setting.control === "number") {
            const num = Number(value);
            if (value.trim() === "" || !Number.isFinite(num)) return;
            if (!setting.decimal && !Number.isInteger(num)) return;
            if (setting.min !== undefined && num < setting.min) return;
            if (setting.max !== undefined && num > setting.max) return;
        }
        setValues((prev) => ({ ...prev, [setting.id]: value }));
        const pending = timers.get(setting.id);
        if (pending) clearTimeout(pending);
        if (setting.control === "number" || setting.control === "text") {
            timers.set(
                setting.id,
                setTimeout(() => {
                    timers.delete(setting.id);
                    void save(setting.id, value);
                }, TYPED_SAVE_DEBOUNCE_MS),
            );
        } else {
            void save(setting.id, value);
        }
    };

    const asField = (setting: LoaderSettingView): PropertyField => ({
        key: setting.id,
        title: setting.title,
        description: setting.description,
        control: setting.control,
        defaultValue: setting.value,
        min: setting.min,
        max: setting.max,
        maxLength: setting.maxLength,
        step: setting.decimal ? "any" : undefined,
        options: setting.options ? () => setting.options! : undefined,
    });

    const item = (setting: LoaderSettingView) => (
        <PaperSettingItem
            title={setting.title}
            description={
                setting.warning ? (
                    <>
                        {setting.description} <strong>{setting.warning}</strong>
                    </>
                ) : (
                    setting.description
                )
            }
        >
            <FieldControl
                field={asField(setting)}
                value={() => values()[setting.id] ?? setting.value}
                onUpdate={(value) => update(setting, value)}
            />
        </PaperSettingItem>
    );

    const fileError = (group: LoaderGroupView) => (
        <Show when={group.error}>
            <PaperQuote variant="danger" icon="warning" title={`Could not read ${group.path}`}>
                {group.error}
            </PaperQuote>
        </Show>
    );

    return (
        <>
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="Not saved" onDismiss={() => setSaveError("")}>
                    {saveError()}
                </PaperQuote>
            </Show>
            <Show
                when={!props.plain}
                fallback={
                    <>
                        <For each={props.groups}>{fileError}</For>
                        <PaperSettingList autoHeight>
                            <For each={props.groups.flatMap((group) => group.settings)}>{item}</For>
                        </PaperSettingList>
                    </>
                }
            >
                <For each={props.groups}>
                    {(group) => (
                        <PaperFlex direction="column" gap="half">
                            <PaperFlex direction="row" justify="space-between" align="center" fullWidth>
                                <PaperText size={3} weight={700}>
                                    {group.label}
                                </PaperText>
                                <PaperText size={2} color="text-subtle">
                                    {group.path}
                                </PaperText>
                            </PaperFlex>
                            {fileError(group)}
                            <PaperSettingList autoHeight>
                                <For each={group.settings}>{item}</For>
                            </PaperSettingList>
                        </PaperFlex>
                    )}
                </For>
            </Show>
        </>
    );
}
