import { Show, createEffect, createSignal, on, type Component } from "solid-js";
import {
    PaperCheckbox,
    PaperModal,
    PaperFlex,
    PaperButton,
    PaperText,
    PaperError,
    createAction,
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
// person ticks the box, and each opening starts with it unticked. An
// uninstall that left packages behind keeps the dialog open to say so.
const UninstallPanelModal: Component<UninstallPanelModalProps> = (props) => {
    const action = createAction();
    const busy = action.busy;
    const [deleteData, setDeleteData] = createSignal(false);
    // the panel is gone, but the packages only it used are still on the computer: why
    const [leftBehind, setLeftBehind] = createSignal("");
    // the name the title asks about, kept while the dialog fades out
    const [name, setName] = createSignal("");

    createEffect(
        on(
            () => props.target,
            (target) => {
                setDeleteData(false);
                setLeftBehind("");
                if (target) setName(target.panel.name);
            },
        ),
    );

    const close = () => {
        if (!busy()) props.onClose();
    };

    const confirm = async () => {
        const target = props.target;
        if (!target || busy()) return;
        await action.run(`Couldn't uninstall ${target.panel.name}`, async () => {
            try {
                const { packagesWarning } = await panelsApi.uninstall(target.panel.id, target.compId, { deleteData: deleteData() });
                await props.onUninstalled(target);
                if (packagesWarning) setLeftBehind(packagesWarning);
                else props.onClose();
            } catch (err) {
                logToMain("error", "Failed to uninstall panel:", err);
                throw err;
            }
        });
    };

    return (
        <PaperModal
            open={props.target !== null}
            onClose={close}
            title={leftBehind() ? "Panel Uninstalled" : `Uninstall ${name()}?`}
            size="small"
            footer={
                <Show when={!leftBehind()} fallback={<PaperButton onClick={close}>Close</PaperButton>}>
                    <PaperButton onClick={close} variant="text" disabled={busy()}>
                        Cancel
                    </PaperButton>
                    <PaperButton onClick={() => void confirm()} variant="danger" disabled={busy()}>
                        {busy() ? "Uninstalling..." : "Uninstall"}
                    </PaperButton>
                </Show>
            }
        >
            <Show when={leftBehind()}>
                {(why) => <PaperError alert title={`Couldn't remove the packages only ${props.target?.panel.name ?? "the panel"} used`} error={why()} />}
            </Show>
            <Show when={!leftBehind() && props.target}>
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="text">
                        Its settings and files stay, so installing it again picks up where you left off.
                    </PaperText>
                    <PaperCheckbox
                        checked={deleteData()}
                        disabled={busy()}
                        onChange={setDeleteData}
                        label="Delete its settings and files too"
                        description="Saved keys and backups go with them. This can't be undone."
                    />
                </PaperFlex>
            </Show>
        </PaperModal>
    );
};

export default UninstallPanelModal;
