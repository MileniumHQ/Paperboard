import {
    createContext,
    createEffect,
    useContext,
    createSignal,
    createSelector,
    splitProps,
    type Accessor,
    type ParentProps,
    type JSX,
} from "solid-js";
import { callEventHandler } from "../../utils/events";
import hidden from "../shared/visuallyHidden.module.css";

export interface SelectionProviderProps {
    name: string;
    value?: string | number;
    defaultValue?: string | number;
    onValueChange?: (value: string | number) => void;
    /** Any number of items can be chosen; `values` and `onValuesChange` replace `value`. */
    multiple?: boolean;
    values?: readonly (string | number)[];
    defaultValues?: readonly (string | number)[];
    onValuesChange?: (values: (string | number)[]) => void;
}

/** The selection props of a single-choice container (a menu, a rail). */
export type SingleSelectionProviderProps = Omit<
    SelectionProviderProps,
    "multiple" | "values" | "defaultValues" | "onValuesChange"
>;

export interface SelectionContextType {
    name: Accessor<string>;
    multiple: Accessor<boolean>;
    currentValue: Accessor<string | number | undefined>;
    isSelected: (key: string | number) => boolean;
    setValue: (val: string | number) => void;
    /** Changes on every choice, kept or not: the native inputs resync to it. */
    choices: Accessor<void>;
}

export const SelectionContext = createContext<SelectionContextType>();

export function useSelectionContext() {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error("Selection items must be used inside their parent container.");
    }
    return context;
}

export function SelectionProvider(props: ParentProps<SelectionProviderProps>) {
    const [internalValue, setInternalValue] = createSignal(props.defaultValue);
    const [internalValues, setInternalValues] = createSignal<readonly (string | number)[]>(props.defaultValues ?? []);

    const currentValue = () => (props.value !== undefined ? props.value : internalValue());
    const currentValues = () => props.values ?? internalValues();
    const isSelected = createSelector(currentValue);
    const [choices, chosen] = createSignal<void>(undefined, { equals: false });

    const contextValue: SelectionContextType = {
        name: () => props.name,
        multiple: () => Boolean(props.multiple),
        currentValue,
        isSelected: (key) => (props.multiple ? currentValues().includes(key) : isSelected(key)),
        choices,
        setValue: (val: string | number) => {
            if (props.multiple) {
                // choosing a chosen item unchooses it
                const was = currentValues();
                const next = was.includes(val) ? was.filter((v) => v !== val) : [...was, val];
                if (props.values === undefined) setInternalValues(next);
                props.onValuesChange?.(next);
            } else {
                if (props.value === undefined) {
                    setInternalValue(() => val);
                }
                props.onValueChange?.(val);
            }
            chosen();
        },
    };

    return (
        <SelectionContext.Provider value={contextValue}>
            {props.children}
        </SelectionContext.Provider>
    );
}

/** An item's place in its container. Both are read live, so an item follows its props. */
export function useSelectionItem(value: Accessor<string | number>, disabled?: Accessor<boolean | undefined>) {
    const context = useSelectionContext();
    const isSelected = () => context.isSelected(value());
    const select = () => {
        if (!disabled?.()) {
            context.setValue(value());
        }
    };

    return {
        isSelected,
        select,
        name: context.name,
        currentValue: context.currentValue,
    };
}

export interface SelectionRadioInputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
    value: string | number;
    disabled?: boolean;
    /**
     * Pressing the item that is already chosen chooses it again, for a list
     * of buttons: an input that is already checked sends no change of its own.
     */
    reselect?: boolean;
}

export function SelectionRadioInput(props: SelectionRadioInputProps) {
    const [local, rest] = splitProps(props, ["value", "disabled", "reselect", "onClick", "ref"]);
    const { isSelected, select, name } = useSelectionItem(
        () => local.value,
        () => local.disabled,
    );
    const context = useSelectionContext();
    let input!: HTMLInputElement;

    // A click checks the native input before anyone decides: when the parent
    // keeps another value (or holds it for later), every input in the group
    // goes back to showing what is actually chosen, so pressing it again
    // still sends a change.
    createEffect(() => {
        context.choices();
        input.checked = isSelected();
    });

    return (
        <input
            {...rest}
            ref={(el) => {
                input = el;
                if (typeof local.ref === "function") local.ref(el);
            }}
            type={context.multiple() ? "checkbox" : "radio"}
            name={name()}
            value={local.value}
            checked={isSelected()}
            disabled={local.disabled}
            onClick={(e) => {
                // checked already flipped on a press of an unchosen item, and
                // isSelected has not: only a press on the chosen one counts here
                const wasChosen = isSelected();
                callEventHandler(local.onClick, e);
                if (local.reselect && wasChosen && !context.multiple()) select();
            }}
            onChange={select}
            class={hidden.visuallyHidden}
        />
    );
}
