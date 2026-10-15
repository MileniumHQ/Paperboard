import {
    createContext,
    useContext,
    createSignal,
    createSelector,
    splitProps,
    type Accessor,
    type ParentProps,
    type JSX,
} from "solid-js";

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

export interface SelectionContextType {
    name: Accessor<string>;
    multiple: Accessor<boolean>;
    currentValue: Accessor<string | number | undefined>;
    isSelected: (key: string | number) => boolean;
    setValue: (val: string | number) => void;
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

    const contextValue: SelectionContextType = {
        name: () => props.name,
        multiple: () => Boolean(props.multiple),
        currentValue,
        isSelected: (key) => (props.multiple ? currentValues().includes(key) : isSelected(key)),
        setValue: (val: string | number) => {
            if (props.multiple) {
                // choosing a chosen item unchooses it
                const was = currentValues();
                const next = was.includes(val) ? was.filter((v) => v !== val) : [...was, val];
                if (props.values === undefined) setInternalValues(next);
                props.onValuesChange?.(next);
                return;
            }
            if (props.value === undefined) {
                setInternalValue(() => val);
            }
            props.onValueChange?.(val);
        },
    };

    return (
        <SelectionContext.Provider value={contextValue}>
            {props.children}
        </SelectionContext.Provider>
    );
}

export function useSelectionItem(value: string | number, disabled?: boolean) {
    const context = useSelectionContext();
    const isSelected = () => context.isSelected(value);
    const select = () => {
        if (!disabled) {
            context.setValue(value);
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
}

export function SelectionRadioInput(props: SelectionRadioInputProps) {
    const [local, rest] = splitProps(props, ["value", "disabled"]);
    const { isSelected, select, name } = useSelectionItem(local.value, local.disabled);
    const context = useSelectionContext();

    return (
        <input
            {...rest}
            type={context.multiple() ? "checkbox" : "radio"}
            name={name()}
            value={local.value}
            checked={isSelected()}
            disabled={local.disabled}
            onChange={select}
            style={{
                position: "absolute",
                width: "0",
                height: "0",
                padding: "0",
                margin: "0",
                overflow: "hidden",
                "white-space": "nowrap",
                border: "0",
                opacity: "0",
            }}
        />
    );
}
