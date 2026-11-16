import { For, Match, onCleanup, Switch } from "solid-js";
import {
    createRead,
    createSavedValue,
    PaperButton,
    PaperEmptyState,
    PaperSectionHeader,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
    showError,
} from "@mileniumhq/paperui";
import { panelPermissionsApi } from "../../lib/shell";
import type { PanelPermission } from "../../../../shared/panelPermissions";

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
        { key: "key", failure: { title: "Couldn't load panel permissions", retry: true } },
    );
    const entries = () => permissions.value() ?? [];
    onCleanup(panelPermissionsApi.onChanged(() => void permissions.reload()));

    return (
        <>
            <PaperSectionHeader icon="privacy_tip" title="Panel permissions" />
            <Switch>
                <Match when={permissions.value() === undefined && permissions.error()}>
                    <PaperEmptyState icon="error" title="Couldn't load">
                        <PaperButton disabled={permissions.loading()} onClick={() => void permissions.reload()}>
                            Try again
                        </PaperButton>
                    </PaperEmptyState>
                </Match>
                <Match when={entries().length === 0}>
                    <PaperText preset="hint" inset>When a panel asks for your microphone, camera or screen, your answer shows up here.</PaperText>
                </Match>
                <Match when={true}>
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
                                            onChange={(checked) => allowed.set(checked).catch((err) => showError("Couldn't change the permission", err))}
                                        />
                                    </PaperSettingItem>
                                );
                            }}
                        </For>
                    </PaperSettingList>
                </Match>
            </Switch>
        </>
    );
}
