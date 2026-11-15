import { createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import { PaperFlex, PaperQuote, PaperSettingList, PaperText, showToast } from "@mileniumhq/paperui";
import { FieldItem } from "./PropertyFieldControl";
import type { LoaderGroupView, LoaderSettingView } from "../service/loaderSettings";
import type { PropertyField } from "../lib/properties";

const TYPED_SAVE_DEBOUNCE_MS = 500;

// Settings that live in a config file the server software owns (the Loader
// tab, Crossplay): one group per file. Every edit saves through the tab's
// saves, one at a time in the order made; typed values wait for a pause
// first. A refused write shows its reason and reads the files again.
export default function ConfigSettings(props: {
    groups: LoaderGroupView[];
    write: (id: string, value: string) => Promise<unknown>;
    reload: () => Promise<void>;
    /** one list with no file names: for a tab where the files are an implementation detail */
    plain?: boolean;
}) {
    const [saveError, setSaveError] = createSignal("");
    let left = false;
    onCleanup(() => (left = true));
    const saves = createSaves({
        failed: (err) => {
            const message = errorMessage(err);
            // a save sent as the tab closed has nowhere on the tab to say so
            if (left) {
                showToast({ variant: "danger", title: "Setting not saved", message });
                return;
            }
            setSaveError(message);
            void props.reload();
        },
        changed: () => setSaveError(""),
    });

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

    // a row is one setting as the files hold it: read again changed, it is a new row
    const item = (setting: LoaderSettingView) => {
        const saved = saves.setting(setting.id, () => setting.value, async (value: string) => {
            await props.write(setting.id, value);
        });
        // what is typed shows while it waits for typing to pause
        const [typed, setTyped] = createSignal<string | null>(null);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const send = (value: string) => {
            clearTimeout(timer);
            timer = undefined;
            setTyped(null);
            saved.set(value);
        };
        // an edit still waiting for typing to pause is sent, not dropped, when the tab goes
        onCleanup(() => {
            const waiting = untrack(typed);
            if (timer !== undefined && waiting !== null) send(waiting);
        });
        // a number field hands on only a number the setting takes
        const update = (value: string) => {
            if (setting.control !== "number" && setting.control !== "text") return send(value);
            setTyped(value);
            clearTimeout(timer);
            timer = setTimeout(() => send(value), TYPED_SAVE_DEBOUNCE_MS);
        };
        return (
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
                value={() => typed() ?? saved.value()}
                onUpdate={update}
            />
        );
    };

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
