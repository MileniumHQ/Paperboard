import { isArrayInputType, expectedTypeOf } from "../../lib/inputTypes";
import { placeCaretAtEnd, renderHtmlWithChips } from "../../lib/richText";

interface TypedVariablePillProps {
    blockId?: string;
    paramKey: string;
    def: any;
    value?: any;
    placeholder: string;
    isTrigger?: boolean;
    isRequired?: boolean;
    disabled?: boolean;
    onChange?: (val: any) => void;
    onRequestVariablePicker?: (
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        isArray?: boolean,
        anchor?: HTMLElement,
    ) => void;
}

// variable-only pill, array variant keeps a real text cursor
export default function TypedVariablePill(pillProps: TypedVariablePillProps) {
    let pillRef: HTMLSpanElement | undefined;
    const isArray = () => isArrayInputType(pillProps.def?.type);
    const expectedType = () => expectedTypeOf(pillProps.def);
    const hasValue = () => {
        const v = pillProps.value;
        return v !== undefined && v !== null && String(v).trim() !== "";
    };
    const isColorless = () =>
        !hasValue() &&
        Boolean(pillProps.isTrigger || !pillProps.isRequired || pillProps.disabled);
    const isRequiredError = () =>
        !hasValue() &&
        Boolean(pillProps.isRequired) &&
        !pillProps.isTrigger &&
        !pillProps.disabled;

    const openPicker = (anchor: HTMLElement) => {
        if (pillProps.disabled) return;
        const rect = anchor.getBoundingClientRect();
        pillProps.onRequestVariablePicker?.(
            Math.round(rect.left),
            Math.round(rect.bottom + 4),
            (varId, label, icon) => {
                const chip = `{{${varId}:${label}:${icon}}}`;
                if (isArray()) {
                    const current = String(pillProps.value || "").trim();
                    const next = current ? `${current} ${chip}` : chip;
                    pillProps.onChange?.(next);
                } else {
                    pillProps.onChange?.(chip);
                }
            },
            expectedType(),
            isArray(),
            pillRef,
        );
    };

    const removeLastChip = () => {
        const current = String(pillProps.value || "");
        const refs = current.match(/\{\{[^}]+\}\}/g) || [];
        if (refs.length === 0) return;
        const last = refs[refs.length - 1];
        const idx = current.lastIndexOf(last);
        const next = (current.slice(0, idx) + current.slice(idx + last.length))
            .replace(/\s{2,}/g, " ")
            .trim();
        pillProps.onChange?.(next);
        requestAnimationFrame(() => {
            if (pillRef) placeCaretAtEnd(pillRef);
        });
    };

    const handlePillClick = (e: MouseEvent) => {
        e.stopPropagation();
        if (pillProps.disabled || !pillProps.blockId) return;
        openPicker(e.currentTarget as HTMLElement);
    };

    return (
        <span
            ref={pillRef}
            class={`actionInput actionVariableOnly ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
            data-placeholder={pillProps.placeholder}
            data-has-value={hasValue() ? "true" : "false"}
            data-array={isArray() ? "true" : "false"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handlePillClick}
            onPaste={(e) => e.preventDefault()}
            onBeforeInput={(e) => {
                e.preventDefault();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Backspace" || e.key === "Delete") {
                    e.preventDefault();
                    removeLastChip();
                    return;
                }
                if (
                    isArray() &&
                    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(
                        e.key,
                    )
                ) {
                    return;
                }
                e.preventDefault();
            }}
            tabIndex={pillProps.disabled ? -1 : 0}
            title={hasValue() ? "Click to change variable" : `Select ${pillProps.placeholder}`}
            spellcheck={false}
            contenteditable={isArray() && !pillProps.disabled}
            // @ts-ignore chip markup
            innerHTML={
                hasValue()
                    ? isArray()
                        // zero-width anchors give the caret places to sit between chips
                        ? renderHtmlWithChips(String(pillProps.value))
                        : renderHtmlWithChips(String(pillProps.value)).replace(
                              /[\u200B\uFEFF]/g,
                              "",
                          )
                    : ""
            }
        />
    );
}
