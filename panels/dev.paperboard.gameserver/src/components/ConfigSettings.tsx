import { createEffect, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { errorMessage } from "../lib/failure";
import { PaperFlex, PaperQuote, PaperSettingList, PaperText, showToast } from "@mileniumhq/paperui";
import { FieldItem } from "./PropertyFieldControl";
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
    // what was typed or picked, over what the files hold: a setting shows
    // its edit until the files are read again with nothing of it unsaved
    const [edits, setEdits] = createSignal<Record<string, string>>({});
    const [saveError, setSaveError] = createSignal("");
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // saves of each setting still running
    const saving = new Map<string, number>();
    const unsaved = (id: string) => timers.has(id) || saving.has(id);
    const shown = (setting: LoaderSettingView) => edits()[setting.id] ?? setting.value;
    const dropEdits = (keep: (id: string) => boolean) =>
        setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => keep(id))));

    // a read of the files is the truth for every setting with nothing unsaved
    createEffect(on(() => props.groups, () => dropEdits(unsaved), { defer: true }));

    let left = false;
    const save = async (id: string, value: string) => {
        saving.set(id, (saving.get(id) ?? 0) + 1);
        const settled = () => {
            const running = saving.get(id)! - 1;
            if (running > 0) saving.set(id, running);
            else saving.delete(id);
        };
        try {
            await props.write(id, value);
            settled();
            setSaveError("");
        } catch (err) {
            settled();
            // a refused edit gives way to what the files hold, unless a newer one waits
            dropEdits((other) => other !== id || unsaved(id));
            const message = errorMessage(err);
            // a save sent as the tab closed has nowhere on the tab to say so
            if (left) {
                showToast({ variant: "danger", title: "Setting not saved", message });
                return;
            }
            setSaveError(message);
            await props.reload();
        }
    };

    onCleanup(() => {
        left = true;
        // a pending edit is sent, not dropped, when leaving the tab
        for (const [id, timer] of timers) {
            clearTimeout(timer);
            const edit = untrack(edits)[id];
            if (edit !== undefined) void save(id, edit);
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
        setEdits((prev) => ({ ...prev, [setting.id]: value }));
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
        <FieldItem
            field={asField(setting)}
            description={
                setting.warning ? (
                    <>
                        {setting.description} <strong>{setting.warning}</strong>
                    </>
                ) : (
                    setting.description
                )
            }
            value={() => shown(setting)}
            onUpdate={(value) => update(setting, value)}
        />
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
