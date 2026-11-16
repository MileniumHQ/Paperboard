// Renaming a tab. The modal stays open until the service has the new name,
// so a refusal is a toast over it, and the name typed is still there to retry.
import { createSignal } from "solid-js";
import { PaperButton, PaperFlex, PaperInput, PaperModal, showError } from "@mileniumhq/paperui";
import { terminal } from "./client";

export function createRenameTab() {
    const [tabId, setTabId] = createSignal<string | null>(null);
    const [value, setValue] = createSignal("");
    const [saving, setSaving] = createSignal(false);

    /** opens on the tab, starting from the name it shows */
    const open = (id: string, shown: string) => {
        setTabId(id);
        setValue(shown);
    };
    const close = () => setTabId(null);
    const canSave = () => value().trim() !== "" && !saving();
    const save = async () => {
        const id = tabId();
        if (!id || !canSave()) return;
        setSaving(true);
        try {
            // the new label arrives through the service's state
            await terminal.calls.renameTab({ id, label: value().trim() });
            close();
        } catch (err) {
            showError("Couldn't rename the tab", err);
        } finally {
            setSaving(false);
        }
    };

    const modal = (
        <PaperModal
            open={tabId() !== null}
            onClose={close}
            title="Rename Tab"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={close}>Cancel</PaperButton>
                    <PaperButton disabled={!canSave()} onClick={() => void save()}>
                        {saving() ? "Saving…" : "Save"}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperInput
                    fullWidth
                    label="Tab name"
                    value={value()}
                    onInput={(e) => setValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void save();
                    }}
                    autofocus
                />
            </PaperFlex>
        </PaperModal>
    );
    return { open, modal };
}
