import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperButton, PaperQuote, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { panelPermissionsApi } from "../../lib/shell";
import { createSavedValue } from "../../lib/saveQueue";
import type { PanelPermission, PanelPermissionEntry } from "../../../../shared/panelPermissions";
import { errorMessage } from "../../lib/errorMessage";

const TITLES: Record<PanelPermission, string> = {
    microphone: "Microphone",
    camera: "Camera",
    screen: "Screen sharing",
};

// Every answer you've given a panel that asked for your microphone, camera
// or screen, and a switch to change it.
export default function PanelPermissionSettings(props: { panelName: (panelId: string) => string }) {
    // Every change reloads the whole list. Reconciled by panel and
    // permission, a row stays the same row, and keeps its switch, across
    // reloads.
    const [entries, setEntries] = createStore<(PanelPermissionEntry & { key: string })[]>([]);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const failed = (title: string, err: unknown) => setError({ title, message: errorMessage(err) });

    // a newer reload wins over an older one still out
    let loads = 0;
    const load = async () => {
        const request = ++loads;
        try {
            const list = await panelPermissionsApi.list();
            if (request !== loads) return;
            setEntries(reconcile(list.map((entry) => ({ ...entry, key: `${entry.panelId}\n${entry.permission}` })), { key: "key" }));
            setError(null);
        } catch (err) {
            if (request === loads) failed("Panel permissions not loaded", err);
        }
    };

    onMount(() => {
        void load();
        onCleanup(panelPermissionsApi.onChanged(() => void load()));
    });

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
                        {(entry) => {
                            // the switch flips at once; a reload brings what is saved
                            const allowed = createSavedValue(entry.answer === "allowed", (next) =>
                                panelPermissionsApi.set(entry.panelId, entry.permission, next ? "allowed" : "denied"),
                            );
                            createEffect(on(() => entry.answer, (answer) => allowed.loaded(answer === "allowed"), { defer: true }));
                            return (
                                <PaperSettingItem title={props.panelName(entry.panelId)} description={TITLES[entry.permission]}>
                                    <PaperToggle
                                        checked={allowed.value()}
                                        aria-label={`Let ${props.panelName(entry.panelId)} use the ${TITLES[entry.permission].toLowerCase()}`}
                                        onChange={(checked) => allowed.change(checked).catch((err) => failed("Permission not changed", err))}
                                    />
                                </PaperSettingItem>
                            );
                        }}
                    </For>
                </PaperSettingList>
            </Show>
        </>
    );
}
