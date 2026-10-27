import { createSignal, Index, Show } from "solid-js";
import ActionEditableField from "./EditableField";

interface ListItemsFieldProps {
    blockId?: string;
    paramKey: string;
    label: string;
    value: unknown;
    itemPlaceholder: string;
    isNumber: boolean;
    isRequired: boolean;
    disabled: boolean;
    onChange: (items: string[] | undefined) => void;
    onRequestVariablePicker: (
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        anchor?: HTMLElement,
    ) => void;
}

// a typed list edited item by item: each item is its own field (text or
// variables), and a trailing field adds the next item once it is left
export default function ListItemsField(listProps: ListItemsFieldProps) {
    const items = (): string[] => {
        const v = listProps.value;
        if (Array.isArray(v)) return v.map((item) => (item == null ? "" : String(item)));
        return v == null || String(v).trim() === "" ? [] : [String(v)];
    };
    const [addGeneration, setAddGeneration] = createSignal(0);
    const commit = (next: string[]) => {
        const kept = next.filter((item) => item.trim() !== "");
        listProps.onChange(kept.length ? kept : undefined);
    };
    // an edit lands when the field is left: adding or removing an item
    // under the caret (a chip insert, a deleted chip) would move the field
    const stillEditing = (wrap: HTMLElement | undefined) =>
        Boolean(wrap && wrap.contains(document.activeElement));

    return (
        <span class="actionListItems" role="group" aria-label={listProps.label}>
            <Index each={items()}>
                {(item, index) => {
                    let wrap: HTMLSpanElement | undefined;
                    return (
                        <span ref={wrap} class="actionListItem">
                            <ActionEditableField
                                blockId={listProps.blockId}
                                paramKey={`${listProps.paramKey}.${index}`}
                                isNumber={listProps.isNumber}
                                initialValue={item()}
                                placeholder={listProps.itemPlaceholder}
                                disabled={listProps.disabled}
                                onCommit={(v) => {
                                    const text = v == null ? "" : String(v);
                                    if (text.trim() === "" && stillEditing(wrap)) return;
                                    const next = [...items()];
                                    next[index] = text;
                                    commit(next);
                                }}
                                onRequestVariablePicker={listProps.onRequestVariablePicker}
                            />
                        </span>
                    );
                }}
            </Index>
            <Show when={!listProps.disabled}>
                <Show when={addGeneration() + 1} keyed>
                    {(_generation) => {
                        let wrap: HTMLSpanElement | undefined;
                        return (
                            <span ref={wrap} class="actionListItem actionListAdd">
                                <ActionEditableField
                                    blockId={listProps.blockId}
                                    paramKey={`${listProps.paramKey}.new`}
                                    isNumber={listProps.isNumber}
                                    initialValue=""
                                    placeholder={items().length ? "Add item" : listProps.itemPlaceholder}
                                    isRequired={listProps.isRequired && items().length === 0}
                                    onCommit={(v) => {
                                        const text = v == null ? "" : String(v);
                                        if (text.trim() === "" || stillEditing(wrap)) return;
                                        commit([...items(), text]);
                                        setAddGeneration((n) => n + 1);
                                    }}
                                    onRequestVariablePicker={listProps.onRequestVariablePicker}
                                />
                            </span>
                        );
                    }}
                </Show>
            </Show>
        </span>
    );
}
