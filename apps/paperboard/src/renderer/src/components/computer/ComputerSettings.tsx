import { type Component, Show, createSignal } from "solid-js";
import {
    PaperText,
    PaperButton,
    PaperSettingList,
    PaperSettingItem,
    PaperFlex,
    PaperModal,
    PaperPage,
    PaperPageHeader,
} from "@mileniumhq/paperui";
import type { ComputerItem } from "../../App";
import { formatOsVersion } from "./ComputerHeader";

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
                icon="info"
                title="Computer Info"
                subtitle={props.computer?.name || "This Computer"}
            />

            <PaperSettingList autoHeight>
                <PaperSettingItem title="Computer Name">
                    <PaperText size={3} weight={600}>
                        {props.computer?.name || "This Computer"}
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem title="Network Address">
                    <PaperText size={3} weight={600} color="text-subtle">
                        {props.computer?.networkAddress || props.computer?.host || "127.0.0.1"}
                        <Show when={!isLocal()}>
                            :{props.computer?.port || 45464}
                        </Show>
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem title="Operating System">
                    <PaperText size={3} weight={600}>
                        {formatOsVersion(props.computer)}
                    </PaperText>
                </PaperSettingItem>

                <Show when={!isLocal()}>
                    <PaperSettingItem
                        title="Remove Computer"
                        description="Forget this computer and disconnect all panels"
                    >
                        <PaperButton
                            variant="danger"
                            disabled={isRemoving()}
                            onClick={() => setIsConfirmOpen(true)}
                        >
                            {isRemoving() ? "Removing..." : "Forget Computer"}
                        </PaperButton>
                    </PaperSettingItem>
                </Show>
            </PaperSettingList>

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
