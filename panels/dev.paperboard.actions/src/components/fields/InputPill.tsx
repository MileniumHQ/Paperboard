// The field for one input on a block, picked by what the input declares:
// a toggle, a dropdown, a list, a variable-only pill, a colour, or text.
import { Show } from "solid-js";
import { innerTypeOf, isTypedOnlyInput, isLiteralListInput, expectedTypeOf } from "../../lib/inputTypes";
import type { TemplateToken } from "../../lib/template";
import type { ActionBlockProps } from "../actionBlockProps";
import ActionEditableField from "./EditableField";
import ListItemsField from "./ListItemsField";
import TypedVariablePill from "./TypedVariablePill";
import BoolField from "./BoolField";
import OptionField from "./OptionField";
import type { FieldSlot } from "./slot";

export interface InputPillProps {
    block: ActionBlockProps;
    token: TemplateToken;
    def: any;
    /** shown when empty in place of the input's own placeholder */
    placeholderOverride?: string;
    /** the value breaks a limit its input declares */
    invalid?: boolean;
}

export default function InputPill(props: InputPillProps) {
    const block = props.block;
    const key = props.token.key!;
    // the field kind is chosen once, as the block renders
    const def = props.def;
    const isTrigger = Boolean(block.isTrigger);
    const val = () => block.values?.[key];
    const hasValue = () => {
        const v = val();
        return v !== undefined && v !== null && String(v).trim() !== "";
    };

    const placeholderText = () => {
        if (props.placeholderOverride) return props.placeholderOverride;
        if (isTrigger) return "(any)";
        const raw = def?.placeholder || props.token.label || "(any)";
        if (raw === "any" || raw === "(any)") return "(any)";
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    };

    const slot: FieldSlot = {
        block,
        key,
        def,
        label: props.token.label || "",
        value: val,
        hasValue,
        placeholder: placeholderText,
        colorless: () => !hasValue() && Boolean(isTrigger || !def?.required || block.static),
        requiredError: () => !hasValue() && Boolean(def?.required) && !isTrigger && !block.static,
    };

    // a text field asks for any variable of the input's type
    const requestTextVariable = (
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        anchor?: HTMLElement,
    ) => {
        if (block.id) {
            block.onRequestVariablePicker?.(block.id, key, x, y, onInsert, expectedTypeOf(def), false, anchor);
        }
    };

    if (def?.type === "boolean") return <BoolField slot={slot} />;

    if (Array.isArray(def?.options) && (def.options.length > 0 || def.allowEmpty)) {
        return <OptionField slot={slot} />;
    }

    // a typed list of text or numbers is edited item by item; a bare
    // "array" input also takes text or an object, so it stays one field
    if (!isTrigger && isLiteralListInput(def)) {
        return (
            <ListItemsField
                blockId={block.id}
                paramKey={key}
                label={props.token.label || key}
                value={val()}
                itemPlaceholder={placeholderText()}
                isNumber={innerTypeOf(def!.type!) === "number"}
                isRequired={Boolean(def?.required)}
                disabled={Boolean(block.static)}
                onChange={(items) => {
                    if (block.id) block.onValueChange?.(block.id, key, items);
                }}
                onRequestVariablePicker={(x, y, onInsert, anchor) => {
                    if (block.id) {
                        block.onRequestVariablePicker?.(
                            block.id,
                            key,
                            x,
                            y,
                            onInsert,
                            // text items interpolate any variable; a typed
                            // item takes its type or a whole list of it,
                            // which the run spreads in
                            expectedTypeOf(def) === "string" ? "string" : def!.type,
                            true,
                            anchor,
                        );
                    }
                }}
            />
        );
    }

    if (!isTrigger && isTypedOnlyInput(def)) {
        return (
            <TypedVariablePill
                blockId={block.id}
                paramKey={key}
                def={def}
                value={val()}
                placeholder={placeholderText()}
                isTrigger={isTrigger}
                isRequired={Boolean(def?.required)}
                disabled={Boolean(block.static)}
                onChange={(newVal) => {
                    if (block.id) block.onValueChange?.(block.id, key, newVal);
                }}
                onRequestVariablePicker={(x, y, onInsert, expectedType, isArray, anchor) => {
                    if (block.id) {
                        block.onRequestVariablePicker?.(block.id, key, x, y, onInsert, expectedType, isArray, anchor);
                    }
                }}
            />
        );
    }

    if (def?.type === "color") {
        const hexValue = () => String(val() ?? "").trim();
        const isHex = () => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexValue());
        return (
            <span class="actionColorWrap">
                <Show when={isHex()}>
                    <span
                        class="actionColorDot"
                        style={{ background: hexValue() }}
                        title={hexValue()}
                    />
                </Show>
                <ActionEditableField
                    blockId={block.id}
                    paramKey={key}
                    isNumber={false}
                    initialValue={val()}
                    placeholder={placeholderText()}
                    isTrigger={isTrigger}
                    isRequired={Boolean(def?.required)}
                    disabled={Boolean(block.static)}
                    onCommit={(newVal) => {
                        block.onValueChange?.(block.id!, key, newVal);
                    }}
                    onRequestVariablePicker={requestTextVariable}
                />
            </span>
        );
    }

    return (
        <ActionEditableField
            blockId={block.id}
            paramKey={key}
            isNumber={def?.type === "number"}
            multiline={Boolean(def?.multiline)}
            inputMode={def?.type === "url" ? "url" : undefined}
            spellcheck={def?.type === "url" ? false : undefined}
            initialValue={val()}
            placeholder={placeholderText()}
            isTrigger={isTrigger}
            isRequired={Boolean(def?.required)}
            disabled={Boolean(block.static)}
            invalid={props.invalid}
            onCommit={(newVal) => {
                block.onValueChange?.(block.id!, key, newVal);
            }}
            onRequestVariablePicker={requestTextVariable}
        />
    );
}
