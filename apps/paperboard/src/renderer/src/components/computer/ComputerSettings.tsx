import { type Component, Show, createSignal } from "solid-js";
import {
    PaperText,
    PaperButton,
    PaperSettingList,
    PaperSettingItem,
    PaperFlex,
    PaperModal,
} from "@paperboard-dev/paperui";
import type { ComputerItem } from "../../App";
import { formatOsVersion } from "./ComputerHeader";

export interface ComputerSettingsProps {
    computer?: ComputerItem;
    onRemove?: (id: string) => Promise<void> | void;
}

const ComputerSettings: Component<ComputerSettingsProps> = (props) => {
    const [isRemoving, setIsRemoving] = createSignal(false);
    const [isConfirmOpen, setIsConfirmOpen] = createSignal(false);

    const isLocal = () => Boolean(props.computer?.isLocal);

    const handleConfirmRemove = async () => {
        if (!props.computer || props.computer.isLocal) return;
        setIsRemoving(true);
        try {
            await props.onRemove?.(props.computer.id);
            setIsConfirmOpen(false);
        } finally {
            setIsRemoving(false);
        }
    };

    return (
        <PaperFlex
            direction="column"
            fullWidth
            fullHeight
            background="frontest"
            style={{
                flex: 1,
                "overflow-y": "auto",
            }}
        >
            <PaperSettingList>
                <PaperSettingItem title="Computer Name">
                    <PaperText size={3} weight={600}>
                        {props.computer?.name || "This Computer"}
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem title="Network Address">
                    <PaperText size={3} weight={600} color="light-text">
                        {props.computer?.host || "127.0.0.1"}:
                        {props.computer?.port || 45464}
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
                        description="Forget this computer and disconnect all boards"
                    >
                        <PaperButton
                            variant="red"
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
                            compact
                            onClick={() => setIsConfirmOpen(false)}
                            disabled={isRemoving()}
                        >
                            Cancel
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="red"
                            disabled={isRemoving()}
                            onClick={handleConfirmRemove}
                        >
                            {isRemoving() ? "Removing..." : "Forget Computer"}
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    Are you sure you want to forget{" "}
                    <strong>{props.computer?.name || "this computer"}</strong>?
                    This will disconnect all boards on this machine.
                </PaperText>
            </PaperModal>
        </PaperFlex>
    );
};

export default ComputerSettings;
