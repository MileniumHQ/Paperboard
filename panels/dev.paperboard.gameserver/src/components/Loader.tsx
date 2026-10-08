import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
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
import { serverBridge, serverSoftware, serverStatus } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import { SOFTWARE_NAMES } from "../lib/software";
import type { LoaderSettingsView, LoaderSettingView } from "../service/loaderSettings";
import type { PropertyField } from "../lib/properties";

const NUMBER_SAVE_DEBOUNCE_MS = 500;

// Loader: the installed software's own settings files (Paper's YAML,
// NeoForge/Forge TOML). The service owns reading and writing; this tab
// only shows what the files hold and sends one validated edit at a time.
export default function Loader(props: { active: boolean }) {
    const [settings, setSettings] = createSignal<LoaderSettingsView | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");
    const [values, setValues] = createSignal<Record<string, string>>({});
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const load = async () => {
        setLoadError("");
        try {
            const view = await serverBridge.call<LoaderSettingsView>(ACTION_IDS.readLoaderSettings);
            const next: Record<string, string> = {};
            for (const group of view.groups) {
                for (const setting of group.settings) next[setting.id] = setting.value;
            }
            setValues(next);
            setSettings(view);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };

    // read whenever the tab opens or the software changes: the files
    // appear on the server's first start and differ per software
    createEffect(
        on([() => props.active, serverSoftware], ([active]) => {
            if (active) void load();
        }),
    );
    onCleanup(() => {
        // a pending number edit is sent, not dropped, when leaving the tab
        for (const [id, timer] of timers) {
            clearTimeout(timer);
            void save(id, values()[id] ?? "");
        }
        timers.clear();
    });

    const save = async (id: string, value: string) => {
        try {
            await serverBridge.call(ACTION_IDS.writeLoaderSetting, { id, value });
            setSaveError("");
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
            // show what the file actually holds after a refused write
            await load();
        }
    };

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
        if (setting.control === "number") {
            timers.set(
                setting.id,
                setTimeout(() => {
                    timers.delete(setting.id);
                    void save(setting.id, value);
                }, NUMBER_SAVE_DEBOUNCE_MS),
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
        options: setting.options ? () => setting.options! : undefined,
    });

    const name = () => SOFTWARE_NAMES[serverSoftware()];

    return (
        <>
            <PaperPageHeader icon="settings_applications" title="Loader" />
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read the loader settings">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={settings()}>
                {(view) => (
                    <Show
                        when={!view().emptyMessage}
                        fallback={
                            <PaperQuote icon="info" title={`No ${name()} settings`}>
                                {view().emptyMessage}
                            </PaperQuote>
                        }
                    >
                        <PaperQuote variant="warning" icon="warning" title="Note">
                            These are {name()}'s own settings files. Changes take effect the next time the server
                            starts{serverStatus() !== "offline" ? ", so restart it to apply them" : ""}.
                        </PaperQuote>
                        <Show when={saveError()}>
                            <PaperQuote variant="danger" icon="warning" title="Not saved">
                                {saveError()}
                            </PaperQuote>
                        </Show>
                        <Show when={view().missing.length > 0 && view().groups.length === 0}>
                            <PaperQuote icon="info" title="Settings not created yet">
                                Start the server once so {name()} creates its settings files, then come back here.
                            </PaperQuote>
                        </Show>
                        <For each={view().groups}>
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
                                    <Show when={group.error}>
                                        <PaperQuote variant="danger" icon="warning" title="Could not read this file">
                                            {group.error}
                                        </PaperQuote>
                                    </Show>
                                    <PaperSettingList autoHeight>
                                        <For each={group.settings}>
                                            {(setting) => (
                                                <PaperSettingItem
                                                    title={setting.title}
                                                    description={
                                                        setting.warning ? (
                                                            <>
                                                                {setting.description}{" "}
                                                                <strong>{setting.warning}</strong>
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
                                            )}
                                        </For>
                                    </PaperSettingList>
                                </PaperFlex>
                            )}
                        </For>
                    </Show>
                )}
            </Show>
        </>
    );
}
