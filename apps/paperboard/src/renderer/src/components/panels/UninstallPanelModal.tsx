import { Show, createEffect, createSignal, on, type Component } from "solid-js";
import {
    PaperCheckbox,
    PaperModal,
    PaperFlex,
    PaperButton,
    PaperText,
    showToast,
} from "@mileniumhq/paperui";
import { panelsApi, type PanelItem } from "@mileniumhq/paperapi";
import { logToMain } from "../../lib/shell";

export interface UninstallTarget {
    compId: string;
    panel: PanelItem;
}

export interface UninstallPanelModalProps {
    /** the panel being uninstalled; null closes the dialog */
    target: UninstallTarget | null;
    onClose: () => void;
    /** the panel is gone: the shell lets go of it before the dialog closes */
    onUninstalled: (target: UninstallTarget) => Promise<void>;
}

// Confirmation dialog for uninstalling a panel. Data is kept unless the
// person ticks the box, and each opening starts with it unticked.
const UninstallPanelModal: Component<UninstallPanelModalProps> = (props) => {
    const [busy, setBusy] = createSignal(false);
    const [deleteData, setDeleteData] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    createEffect(
        on(
            () => props.target,
            () => {
                setDeleteData(false);
                setError(null);
            },
        ),
    );

    const close = () => {
        if (!busy()) props.onClose();
    };

    const confirm = async () => {
        const target = props.target;
        if (!target || busy()) return;
        setBusy(true);
        setError(null);
        try {
            const { packagesWarning } = await panelsApi.uninstall(target.panel.id, target.compId, { deleteData: deleteData() });
            await props.onUninstalled(target);
            if (packagesWarning) {
                showToast({ variant: "warning", title: `${target.panel.name} is uninstalled`, message: packagesWarning, duration: null });
            }
            props.onClose();
        } catch (err) {
            logToMain("error", "Failed to uninstall panel:", err);
            setError(`Couldn't uninstall ${target.panel.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PaperModal
            open={props.target !== null}
            onClose={close}
            title="Uninstall Panel"
            size="small"
            footer={
                <>
                    <PaperButton onClick={close} variant="text" disabled={busy()}>
                        Cancel
                    </PaperButton>
                    <PaperButton onClick={() => void confirm()} variant="danger" disabled={busy()}>
                        {busy() ? "Uninstalling..." : "Uninstall"}
                    </PaperButton>
                </>
            }
        >
            <Show when={props.target}>
                {(target) => (
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="text">
                            Are you sure you want to uninstall{" "}
                            <strong>{target().panel.name}</strong>?
                        </PaperText>
                        <PaperText preset="hint">
                            This stops the panel and removes its installed code.
                            Your configuration, files and saved credentials are
                            kept for reinstalling.
                        </PaperText>
                        <PaperCheckbox
                            checked={deleteData()}
                            disabled={busy()}
                            onChange={setDeleteData}
                            label="Also delete this panel's data and saved credentials"
                            description="Configuration, files and vault entries are removed. This cannot be undone."
                        />
                        <Show when={error()}>
                            <PaperText preset="error">{error()}</PaperText>
                        </Show>
                    </PaperFlex>
                )}
            </Show>
        </PaperModal>
    );
};

export default UninstallPanelModal;
