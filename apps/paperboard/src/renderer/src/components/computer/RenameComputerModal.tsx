import { type Component, createEffect, createSignal, on } from "solid-js";
import { createAction, PaperButton, PaperInput, PaperModal } from "@mileniumhq/paperui";
import { computersApi, type ComputerInfo } from "../../lib/shell";

// matches COMPUTER_NAME_MAX in main's ConnectionPool, which has the last word
const NAME_MAX = 64;

export interface RenameComputerModalProps {
    /** the computer being renamed; undefined closes the dialog */
    computer?: ComputerInfo;
    onClose: () => void;
}

// The name is the computer list's label for the computer, which pairing it
// again keeps. It never renames the machine itself.
const RenameComputerModal: Component<RenameComputerModalProps> = (props) => {
    const [name, setName] = createSignal("");
    const action = createAction();
    const saving = action.busy;

    // each opening starts from the computer's current name; a change pushed
    // while the dialog is open (a status, a reconnect) leaves the typing alone
    createEffect(
        on(
            () => props.computer?.id,
            (id) => {
                if (!id) return;
                setName(props.computer?.name ?? "");
            },
        ),
    );

    const trimmed = () => name().trim();
    // what is wrong with the name as typed, said under its field
    const problem = () => (trimmed().length > NAME_MAX ? `A computer name can be at most ${NAME_MAX} characters.` : undefined);
    const canSave = () =>
        !saving() && trimmed().length > 0 && !problem() && trimmed() !== props.computer?.name;

    const close = () => {
        if (!saving()) props.onClose();
    };

    const save = async () => {
        const computer = props.computer;
        if (!computer || !canSave()) return;
        await action.run("Couldn't rename this computer", async () => {
            if (!(await computersApi.rename(computer.id, trimmed()))) {
                throw new Error("Paperboard doesn't know this computer anymore.");
            }
            props.onClose();
        });
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
                error={problem()}
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
        </PaperModal>
    );
};

export default RenameComputerModal;
