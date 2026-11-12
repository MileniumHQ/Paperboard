import { type Component, Show, createEffect, createSignal } from "solid-js";
import { PaperButton, PaperInput, PaperModal, PaperText } from "@mileniumhq/paperui";
import { computersApi, type ComputerInfo } from "../../lib/shell";

// matches COMPUTER_NAME_MAX in main's ConnectionPool, which has the last word
const NAME_MAX = 64;

export interface RenameComputerModalProps {
    /** the computer being renamed; undefined closes the dialog */
    computer?: ComputerInfo;
    onClose: () => void;
}

// The name is this app's label for the computer. It stays on this device
// and never renames the machine itself.
const RenameComputerModal: Component<RenameComputerModalProps> = (props) => {
    const [name, setName] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    // each opening starts from the computer's current name
    createEffect(() => {
        const computer = props.computer;
        if (!computer) return;
        setName(computer.name);
        setError(null);
    });

    const trimmed = () => name().trim();
    const canSave = () =>
        !saving() && trimmed().length > 0 && trimmed() !== props.computer?.name;

    const close = () => {
        if (!saving()) props.onClose();
    };

    const save = async () => {
        const computer = props.computer;
        if (!computer || !canSave()) return;
        setSaving(true);
        setError(null);
        try {
            if (!(await computersApi.update(computer.id, { name: trimmed() }))) {
                throw new Error("Paperboard doesn't know this computer anymore.");
            }
            props.onClose();
        } catch (err) {
            setError(`Couldn't rename this computer: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperModal
            open={Boolean(props.computer)}
            onClose={close}
            title="Change Name"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" onClick={close} disabled={saving()}>
                        Cancel
                    </PaperButton>
                    <PaperButton onClick={() => void save()} disabled={!canSave()}>
                        {saving() ? "Saving..." : "Save"}
                    </PaperButton>
                </>
            }
        >
            <PaperInput
                fullWidth
                label="Name"
                placeholder="Name"
                icon="computer"
                maxLength={NAME_MAX}
                autofocus
                value={name()}
                disabled={saving()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        void save();
                    }
                }}
            />
            <Show when={error()}>
                <PaperText preset="error">{error()}</PaperText>
            </Show>
        </PaperModal>
    );
};

export default RenameComputerModal;
