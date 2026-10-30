import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PaperButton, PaperQuote, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { panelPermissionsApi } from "../../lib/shell";
import type { PanelPermission, PanelPermissionEntry } from "../../../../shared/panelPermissions";

const TITLES: Record<PanelPermission, string> = {
    microphone: "Microphone",
    camera: "Camera",
    screen: "Screen sharing",
};

// Every answer you've given a panel that asked for your microphone, camera
// or screen, and a switch to change it.
export default function PanelPermissionSettings(props: { panelName: (panelId: string) => string }) {
    const [entries, setEntries] = createSignal<PanelPermissionEntry[]>([]);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const failed = (title: string, err: unknown) => setError({ title, message: err instanceof Error ? err.message : String(err) });

    const load = async () => {
        try {
            setEntries(await panelPermissionsApi.list());
            setError(null);
        } catch (err) {
            failed("Panel permissions not loaded", err);
        }
    };

    onMount(() => {
        void load();
        onCleanup(panelPermissionsApi.onChanged(() => void load()));
    });

    const change = async (entry: PanelPermissionEntry, allowed: boolean) => {
        try {
            await panelPermissionsApi.set(entry.panelId, entry.permission, allowed ? "allowed" : "denied");
        } catch (err) {
            failed("Permission not changed", err);
        }
    };

    return (
        <>
            <PaperText preset="subtitle">Panel permissions</PaperText>
            <Show when={error()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="error" title={failure().title} role="alert" onDismiss={() => setError(null)}>
                        <PaperText breakWord>{failure().message}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>
                            Reload
                        </PaperButton>
                    </PaperQuote>
                )}
            </Show>
            <Show
                when={entries().length > 0}
                fallback={<PaperText size={2} color="text-subtle">When a panel asks for your microphone, camera or screen, your answer shows up here.</PaperText>}
            >
                <PaperSettingList autoHeight>
                    <For each={entries()}>
                        {(entry) => (
                            <PaperSettingItem title={props.panelName(entry.panelId)} description={TITLES[entry.permission]}>
                                <PaperToggle
                                    checked={entry.answer === "allowed"}
                                    aria-label={`Let ${props.panelName(entry.panelId)} use the ${TITLES[entry.permission].toLowerCase()}`}
                                    onChange={(checked) => void change(entry, checked)}
                                />
                            </PaperSettingItem>
                        )}
                    </For>
                </PaperSettingList>
            </Show>
        </>
    );
}
