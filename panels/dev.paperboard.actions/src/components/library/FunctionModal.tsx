// Creating a function (its name and parameters), or renaming one. A
// rename only takes the name: the parameters are fixed once flows use them.
import { createEffect, createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { FUNCTION_PARAM_TYPES, type FunctionDef, type FunctionParam } from "../../lib/functions";

export default function FunctionModal(props: {
    /** "new" to create one, a function to rename it, null when closed */
    target: FunctionDef | "new" | null;
    onClose: () => void;
    onCreate: (name: string, params: FunctionParam[]) => void;
    onRename: (fid: string, name: string) => void;
}) {
    const [draftName, setDraftName] = createSignal("");
    // store keeps row identity stable while typing
    const [draftParams, setDraftParams] = createStore<FunctionParam[]>([]);
    // the last opened target: a closing modal keeps its title while it fades
    const [editingId, setEditingId] = createSignal<string | null>(null);

    // every open starts from the function being renamed, or from nothing
    createEffect(() => {
        const target = props.target;
        if (target === null) return;
        setEditingId(target === "new" ? null : target.id);
        setDraftName(target === "new" ? "" : target.name);
        setDraftParams([]);
    });

    const draftValid = () => {
        if (!draftName().trim()) return false;
        if (editingId()) return true;
        const names = draftParams.map((p) => p.name.trim().toLowerCase());
        if (names.some((n) => !n)) return false;
        return new Set(names).size === names.length;
    };

    const handleConfirmCreate = () => {
        if (!draftValid()) return;
        const eid = editingId();
        if (eid) {
            props.onRename(eid, draftName().trim().replace(/[{}:]/g, ""));
        } else {
            props.onCreate(
                draftName().trim(),
                draftParams.map((p) => ({
                    name: p.name.trim().replace(/[{}:]/g, ""),
                    type: p.type,
                })),
            );
        }
        props.onClose();
    };

    return (
        <PaperModal
            open={props.target !== null}
            onClose={props.onClose}
            title={editingId() ? "Rename Function" : "Create Function"}
            size="large"
            footer={
                <>
                    <PaperButton variant="text" onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton
                        variant="success"
                        onClick={handleConfirmCreate}
                        disabled={!draftValid()}>
                        <PaperIcon>
                            {editingId() ? "check" : "add"}
                        </PaperIcon>
                        {editingId() ? "Save" : "Create"}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="full">
                <PaperFlex direction="column" gap="half">
                    <PaperInput
                        fullWidth
                        autofocus
                        placeholder="Function"
                        maxLength={64}
                        value={draftName()}
                        onInput={(e) => setDraftName(e.currentTarget.value)}
                    />
                    <Show when={editingId()}>
                        <PaperText preset="hint">
                            Renaming updates every flow that uses this function.
                        </PaperText>
                    </Show>
                </PaperFlex>
    
                <Show when={!editingId()}>
                    <PaperFlex direction="column" gap="half">
                        <PaperFlex
                            direction="row"
                            justify="space-between"
                            align="center"
                            fullWidth
                        >
                            <PaperText preset="heading">
                                Parameters
                            </PaperText>
                            <PaperButton
                                onClick={() =>
                                    setDraftParams((prev) => [
                                        ...prev,
                                        { name: "", type: "string" },
                                    ])
                                }>
                                <PaperIcon>add</PaperIcon>
                                Add Parameter
                            </PaperButton>
                        </PaperFlex>
    
                        <Show when={draftParams.length === 0}>
                            <PaperText preset="hint">
                                Parameters become variables other actions can read.
                            </PaperText>
                        </Show>
    
                        <For each={draftParams}>
                            {(param, index) => (
                                <div class="library-param-row">
                                    <PaperInput
                                        compact
                                        fullWidth
                                        placeholder="Parameter"
                                        value={param.name}
                                        onInput={(e) => {
                                            setDraftParams(index(), "name", e.currentTarget.value);
                                        }}
                                    />
                                    <PaperSelectMenu
                                        name={`param-type-${index()}`}
                                        value={param.type}
                                        onValueChange={(v) => {
                                            setDraftParams(index(), "type", String(v));
                                        }}
                                    >
                                        <For each={FUNCTION_PARAM_TYPES}>
                                            {(t) => (
                                                <PaperSelectMenuItem value={t.id}>
                                                    {t.label}
                                                </PaperSelectMenuItem>
                                            )}
                                        </For>
                                    </PaperSelectMenu>
                                    <PaperButton size="tiny"
                                        icon
                                        onClick={() =>
                                            setDraftParams((prev) =>
                                                prev.filter((_, i) => i !== index()),
                                            )
                                        }
                                        title="Remove parameter">
                                        <PaperIcon>delete</PaperIcon>
                                    </PaperButton>
                                </div>
                            )}
                        </For>
                    </PaperFlex>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
