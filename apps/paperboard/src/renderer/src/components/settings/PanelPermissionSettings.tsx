import { createSignal, For, onCleanup, Show } from "solid-js";
import { createRead, createSavedValue, PaperButton, PaperQuote, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { panelPermissionsApi } from "../../lib/shell";
import type { PanelPermission } from "../../../../shared/panelPermissions";
import { errorMessage } from "@mileniumhq/paperapi";

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
    const permissions = createRead(
        async () => (await panelPermissionsApi.list()).map((entry) => ({ ...entry, key: `${entry.panelId}\n${entry.permission}` })),
        { key: "key" },
    );
    const entries = () => permissions.value() ?? [];
    onCleanup(panelPermissionsApi.onChanged(() => void permissions.reload()));
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);

    return (
        <>
            <PaperSectionHeader icon="privacy_tip" title="Panel permissions" />
            <Show when={permissions.error()}>
                {(message) => (
                    <PaperQuote variant="danger" icon="error" title="Panel permissions not loaded" role="alert">
                        {message()}
                        <PaperButton size="tiny" onClick={() => void permissions.reload()}>
                            Reload
                        </PaperButton>
                    </PaperQuote>
                )}
            </Show>
            <Show when={error()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="error" title={failure().title} role="alert" onDismiss={() => setError(null)}>
                        {failure().message}
                    </PaperQuote>
                )}
            </Show>
            <Show
                when={entries().length > 0}
                fallback={<PaperText preset="hint" inset>When a panel asks for your microphone, camera or screen, your answer shows up here.</PaperText>}
            >
                <PaperSettingList autoHeight>
                    <For each={entries()}>
                        {(entry) => {
                            // the switch flips at once; a reload brings what is saved
                            const allowed = createSavedValue(
                                () => entry.answer === "allowed",
                                (next) => panelPermissionsApi.set(entry.panelId, entry.permission, next ? "allowed" : "denied"),
                            );
                            return (
                                <PaperSettingItem title={props.panelName(entry.panelId)} description={TITLES[entry.permission]}>
                                    <PaperToggle
                                        checked={allowed.value()}
                                        aria-label={`Let ${props.panelName(entry.panelId)} use the ${TITLES[entry.permission].toLowerCase()}`}
                                        onChange={(checked) => allowed.set(checked).catch((err) => setError({ title: "Permission not changed", message: errorMessage(err) }))}
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
