import { type Component, Show, createSignal } from "solid-js";
import {
    PaperText,
    PaperButton,
    PaperFlex,
    PaperModal,
    PaperPage,
    PaperPageHeader,
} from "@mileniumhq/paperui";
import type { ComputerItem } from "../../App";
import { computerIcon } from "./computerIcon";
import BackupLocations from "../backups/BackupLocations";

export interface ComputerSettingsProps {
    computer?: ComputerItem;
    onRemove?: (
        id: string,
    ) => Promise<{ ok: boolean; error?: string } | void> | void;
}

const ComputerSettings: Component<ComputerSettingsProps> = (props) => {
    const [isRemoving, setIsRemoving] = createSignal(false);
    const [isConfirmOpen, setIsConfirmOpen] = createSignal(false);
    const [removeError, setRemoveError] = createSignal<string | null>(null);

    const isLocal = () => Boolean(props.computer?.isLocal);
    const address = () => {
        const host = props.computer?.networkAddress || props.computer?.host || "127.0.0.1";
        return isLocal() ? host : `${host}:${props.computer?.port || 45464}`;
    };

    const handleConfirmRemove = async () => {
        if (!props.computer || props.computer.isLocal) return;
        setIsRemoving(true);
        try {
            // R4: the modal closes only on success; a failure keeps it
            // open with the reason, mirroring the forget-confirm flow
            const result = await props.onRemove?.(props.computer.id);
            if (result && !result.ok) {
                setRemoveError(result.error ?? "Couldn't forget this computer.");
                return;
            }
            setIsConfirmOpen(false);
        } finally {
            setIsRemoving(false);
        }
    };

    return (
        <PaperPage>
            <PaperPageHeader
                icon={computerIcon({ name: props.computer?.name, isLocal: isLocal() })}
                title={props.computer?.name || "This Computer"}
                subtitle={address()}
            />

            <PaperFlex direction="column" gap="double" fullWidth>
                <Show when={props.computer}>
                    {(computer) => <BackupLocations computerId={computer().id} computerName={computer().name || "This Computer"} />}
                </Show>

                <Show when={!isLocal()}>
                    <PaperFlex direction="row" justify="flex-start">
                        <PaperButton
                            variant="danger"
                            disabled={isRemoving()}
                            onClick={() => setIsConfirmOpen(true)}
                        >
                            {isRemoving() ? "Removing..." : "Forget Computer"}
                        </PaperButton>
                    </PaperFlex>
                </Show>
            </PaperFlex>

            <PaperModal
                open={isConfirmOpen()}
                onClose={() => setIsConfirmOpen(false)}
                title="Forget Computer"
                size="small"
                footer={
                    <PaperFlex
                        direction="row"
                        justify="flex-end"
                        gap="half"
                        fullWidth
                    >
                        <PaperButton
                            onClick={() => setIsConfirmOpen(false)}
                            disabled={isRemoving()}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={isRemoving()}
                            onClick={handleConfirmRemove}>
                            {isRemoving() ? "Removing..." : "Forget Computer"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    Are you sure you want to forget{" "}
                    <strong>{props.computer?.name || "this computer"}</strong>?
                    This will disconnect all panels on this machine.
                </PaperText>
                <Show when={removeError()}>
                    <PaperText size={2} color="danger">
                        {removeError()}
                    </PaperText>
                </Show>
            </PaperModal>
        </PaperPage>
    );
};

export default ComputerSettings;
