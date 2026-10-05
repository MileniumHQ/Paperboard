import { Show, type Component } from "solid-js";
import {
    PaperCheckbox,
    PaperModal,
    PaperFlex,
    PaperButton,
    PaperText,
} from "@mileniumhq/paperui";
import { type PanelItem } from "@mileniumhq/paperapi";

export interface UninstallTarget {
    compId: string;
    panel: PanelItem;
}

interface UninstallPanelModalProps {
    open: boolean;
    target: UninstallTarget | null;
    isBusy: boolean;
    error?: string | null;
    deleteData: boolean;
    onDeleteDataChange: (value: boolean) => void;
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
                            This stops the panel and removes its installed code.
                            Your configuration, files and saved credentials are
                            kept for reinstalling.
                        </PaperText>
                        <PaperCheckbox
                            checked={props.deleteData}
                            disabled={props.isBusy}
                            onChange={(checked) =>
                                props.onDeleteDataChange(checked)
                            }
                            label="Also delete this panel's data and saved credentials"
                            description="Configuration, files and vault entries are removed. This cannot be undone."
                        />
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
