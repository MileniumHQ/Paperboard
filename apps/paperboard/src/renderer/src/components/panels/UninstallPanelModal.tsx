import { Show, type Component } from "solid-js";
import {
    PaperModal,
    PaperFlex,
    PaperButton,
    PaperText,
} from "@paperboard-dev/paperui";
import { type PanelItem } from "@paperboard-dev/paperapi";

export interface UninstallTarget {
    compId: string;
    panel: PanelItem;
}

interface UninstallPanelModalProps {
    open: boolean;
    target: UninstallTarget | null;
    isBusy: boolean;
    error?: string | null;
    onClose: () => void;
    onConfirm: () => void;
}

// Confirmation dialog for uninstalling a panel.
const UninstallPanelModal: Component<UninstallPanelModalProps> = (props) => {
    return (
        <PaperModal
            open={props.open}
            onClose={() => props.onClose()}
            title="Uninstall Panel"
            size="small"
            footer={
                <PaperFlex
                    direction="row"
                    justify="flex-end"
                    gap="half"
                    fullWidth
                >
                    <PaperButton
                        onClick={() => props.onClose()}
                        variant="text"
                        disabled={props.isBusy}>
                        Cancel
                    </PaperButton>
                    <PaperButton
                        onClick={() => props.onConfirm()}
                        variant="danger"
                        disabled={props.isBusy}>
                        {props.isBusy ? "Uninstalling..." : "Uninstall"}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <Show when={props.target}>
                {(target) => (
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="body">
                            Are you sure you want to uninstall{" "}
                            <strong>{target().panel.name}</strong>?
                        </PaperText>
                        <PaperText size={2} color="text-subtle">
                            This will permanently delete the panel package,
                            its configuration file, all stored data files,
                            and terminate any running operations.
                        </PaperText>
                        <Show when={props.error}>
                            <PaperText size={2} color="danger">
                                {props.error}
                            </PaperText>
                        </Show>
                    </PaperFlex>
                )}
            </Show>
        </PaperModal>
    );
};

export default UninstallPanelModal;
