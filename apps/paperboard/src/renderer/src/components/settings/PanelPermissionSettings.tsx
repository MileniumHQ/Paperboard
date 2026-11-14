import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperQuote, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
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
    // Every change reloads the whole list. Reconciled by panel and
    // permission, a row stays the same row across reloads, so the switch
    // just pressed is the one that moves (and plays its haptic) when the
    // answer comes back, instead of a fresh switch drawn in its place.
    const [entries, setEntries] = createStore<(PanelPermissionEntry & { key: string })[]>([]);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const failed = (title: string, err: unknown) => setError({ title, message: err instanceof Error ? err.message : String(err) });

    const load = async () => {
        try {
            const list = await panelPermissionsApi.list();
            setEntries(reconcile(list.map((entry) => ({ ...entry, key: `${entry.panelId}\n${entry.permission}` })), { key: "key" }));
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
            <PaperSectionHeader icon="privacy_tip" title="Panel permissions" />
            <Show when={error()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="error" title={failure().title} role="alert" onDismiss={() => setError(null)}>
                        {failure().message}
                        <PaperButton size="tiny" onClick={() => void load()}>
                            Reload
                        </PaperButton>
                    </PaperQuote>
                )}
            </Show>
            <Show
                when={entries.length > 0}
                fallback={<PaperText preset="hint" inset>When a panel asks for your microphone, camera or screen, your answer shows up here.</PaperText>}
            >
                <PaperSettingList autoHeight>
                    <For each={entries}>
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
