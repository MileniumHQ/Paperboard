// The menus a block field opens: the variable picker (values the flow has
// produced so far) and the option picker (a field's fixed choices).
import { createSignal, onCleanup, onMount } from "solid-js";
import { type PickerVariable, variablesBefore } from "../lib/variableSources";
import type { CanvasDocumentState } from "./document";

export interface PickerOption {
    label: string;
    value: any;
    icon?: string;
    description?: string;
}

export function createPickers(
    doc: CanvasDocumentState,
    setValue: (blockId: string, key: string, value: any) => void,
) {
    const [variablePicker, setVariablePicker] = createSignal<{
        open: boolean;
        blockId: string;
        paramKey: string;
        x: number;
        y: number;
        availableVariables: PickerVariable[];
        onInsert?: (varId: string, label: string, icon: string) => void;
        anchor?: HTMLElement | null;
    }>({
        open: false,
        blockId: "",
        paramKey: "",
        x: 0,
        y: 0,
        availableVariables: [],
        anchor: null,
    });
    // the block a hovered picker item comes from, highlighted on the canvas
    const [hoveredSourceBlockId, setHoveredSourceBlockId] = createSignal<string | null>(null);

    const closeVariablePicker = () => {
        setVariablePicker((prev) => ({ ...prev, open: false }));
        setHoveredSourceBlockId(null);
    };

    const openVariablePicker = (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        onInsert?: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        _isArray?: boolean,
        anchor?: HTMLElement,
    ) => {
        // an empty result still opens: the menu's empty state is the
        // feedback, a silent no-op reads as a broken control
        setVariablePicker({
            open: true,
            blockId,
            paramKey,
            x,
            y,
            availableVariables: variablesBefore(doc.blocks, blockId, doc.functions(), expectedType),
            onInsert,
            anchor: anchor ?? null,
        });
    };

    const selectVariable = (v: { id: string; label: string; icon?: string }) => {
        const picker = variablePicker();
        if (picker.onInsert) {
            picker.onInsert(v.id, v.label, v.icon || "bolt");
        } else if (picker.blockId && picker.paramKey) {
            setValue(picker.blockId, picker.paramKey, `{{${v.id}:${v.label}:${v.icon || "bolt"}}}`);
        }
        // the picker stays up while its field is being edited: inserting a
        // second variable must not cost another click on the field
    };

    onMount(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && variablePicker().open) closeVariablePicker();
        };
        window.addEventListener("keydown", handleGlobalKeyDown);
        onCleanup(() => window.removeEventListener("keydown", handleGlobalKeyDown));
    });

    const [optionPicker, setOptionPicker] = createSignal<{
        open: boolean;
        x: number;
        y: number;
        options: PickerOption[];
        selectedValue?: any;
        onSelect?: (value: any) => void;
    }>({ open: false, x: 0, y: 0, options: [] });

    const openOptionPicker = (
        _blockId: string,
        _paramKey: string,
        x: number,
        y: number,
        options: PickerOption[],
        selectedValue: any,
        onSelect: (value: any) => void,
        _anchor?: HTMLElement,
    ) => {
        setOptionPicker({ open: true, x, y, options, selectedValue, onSelect });
    };

    const closeOptionPicker = () => setOptionPicker((prev) => ({ ...prev, open: false }));

    const selectOption = (value: any) => {
        optionPicker().onSelect?.(value);
        closeOptionPicker();
    };

    return {
        variablePicker,
        hoveredSourceBlockId,
        setHoveredSourceBlockId,
        openVariablePicker,
        closeVariablePicker,
        selectVariable,
        optionPicker,
        openOptionPicker,
        closeOptionPicker,
        selectOption,
    };
}
