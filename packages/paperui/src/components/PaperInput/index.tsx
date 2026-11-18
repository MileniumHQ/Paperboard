import styles from "./index.module.css";
import {
    children,
    splitProps,
    Show,
    createMemo,
    createSignal,
    createEffect,
    on,
    createUniqueId,
    onCleanup,
    type JSX,
} from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { useSettingListText } from "../../contexts/settingList";
import { callEventHandler } from "../../utils/events";
import { cx } from "../../utils/cx";

type Field = HTMLInputElement | HTMLTextAreaElement;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    typeof (value as PromiseLike<unknown> | null)?.then === "function";

/**
 * `ref` is re-declared because the multiline form hands back a textarea, which
 * the inherited input signature cannot express. Attributes that only exist on
 * an input (`type`, `min`, `max`, `step`, `pattern`) have no effect on a
 * multiline field and are ignored.
 */
/** a field's height: the same as a PaperButton of the same size */
export type PaperInputSize = "small" | "medium" | "large";

export interface PaperInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "ref" | "size"> {
    /** The field's name, shown in a notch of its top border. It is the input's accessible name. */
    label?: string;
    icon?: JSX.Element | string;
    /**
     * The field's height, the same as a PaperButton of the same size, so a
     * field and the button beside it line up. Default "medium".
     */
    size?: PaperInputSize;
    fullWidth?: boolean;
    /** Draws the field as wrong, with no words. A field with something to say gets `error`. */
    invalid?: boolean;
    /**
     * What is wrong with the value, said under the field: the field is drawn
     * as wrong, and the message is its description to a screen reader.
     */
    error?: string;
    validate?: (value: string) => boolean;
    defaultValue?: string | number;
    ref?: HTMLInputElement | HTMLTextAreaElement | ((el: HTMLInputElement) => void);
    /** Renders a textarea instead of a single-line field. Every other prop behaves the same. */
    multiline?: boolean;
    /** Visible text rows when multiline. Ignored otherwise. */
    rows?: number;
    /** Whether the browser resize affordance is available when multiline. */
    resize?: boolean;
}

export function PaperInput(props: PaperInputProps) {
    const [local, rest] = splitProps(props, [
        "label",
        "id",
        "icon",
        "size",
        "fullWidth",
        "invalid",
        "error",
        "validate",
        "value",
        "defaultValue",
        "type",
        "disabled",
        "class",
        "classList",
        "onInput",
        "onChange",
        "onBlur",
        "ref",
        "multiline",
        "rows",
        "resize",
    ]);

    const icon = children(() => local.icon);

    // what the parent holds, as text; undefined when the field is its own.
    // Handlers read this memo, never the prop: a prop written as a condition
    // compiles to a getter that makes a computation each time it is read.
    const controlled = createMemo(() => (local.value !== undefined ? String(local.value) : undefined));

    const [internalValue, setInternalValue] = createSignal(controlled() ?? String(local.defaultValue ?? ""));

    createEffect(
        on(controlled, (value) => {
            if (value !== undefined) setInternalValue(value);
        }),
    );

    // in a PaperSettingList, the list's record holds the value
    const listValue = useSettingListText(() => rest.name, "PaperInput");
    const currentValue = () => {
        const value = controlled();
        if (value !== undefined) return value;
        const fromList = listValue();
        return fromList !== undefined ? String(fromList) : internalValue();
    };

    const isInvalid = () => {
        if (local.error) return true;
        if (local.invalid !== undefined) return local.invalid;
        if (local.validate) return !local.validate(currentValue());
        return false;
    };

    // A controlled field shows what its parent holds. Typing is never undone:
    // a parent that takes or reshapes each keystroke answers through `value`.
    // Once the person commits an edit (the change event, then blur when they
    // leave), the caller's change and blur handlers read what was typed, and
    // the parent gets until the next task to answer, or until the promise a
    // handler returned settles. Only then does a field whose parent kept
    // another value go back to it, unless the person has typed again since.
    let typed = 0;
    let resync: { answers: unknown[]; timer: ReturnType<typeof setTimeout> } | undefined;
    onCleanup(() => {
        if (resync) clearTimeout(resync.timer);
    });

    const showParentValue = (field: Field, since: number) => {
        const value = controlled();
        if (since !== typed || value === undefined) return;
        if (field.value !== value) field.value = value;
    };

    const queueResync = (field: Field, answer: unknown) => {
        if (controlled() === undefined) return;
        if (resync) {
            resync.answers.push(answer);
            return;
        }
        const since = typed;
        const answers = [answer];
        const timer = setTimeout(() => {
            resync = undefined;
            const waits = answers.filter(isThenable);
            if (!waits.length) {
                showParentValue(field, since);
                return;
            }
            let left = waits.length;
            const settled = () => {
                left -= 1;
                if (left === 0) showParentValue(field, since);
            };
            for (const wait of waits) {
                // a rejection still reaches the page's unhandled-rejection report
                Promise.resolve(wait).then(settled, (err: unknown) => {
                    settled();
                    throw err;
                });
            }
        });
        resync = { answers, timer };
    };

    const handleInput: JSX.InputEventHandler<Field, InputEvent> = (e) => {
        typed += 1;
        if (controlled() === undefined) setInternalValue(e.currentTarget.value);
        callEventHandler<Field, InputEvent>(local.onInput as never, e);
    };

    const handleChange: JSX.EventHandler<Field, Event> = (e) => {
        if (controlled() === undefined) setInternalValue(e.currentTarget.value);
        const answer = callEventHandler<Field, Event>(local.onChange as never, e);
        queueResync(e.currentTarget, answer);
    };

    const handleBlur: JSX.EventHandler<Field, FocusEvent> = (e) => {
        const answer = callEventHandler<Field, FocusEvent>(local.onBlur as never, e);
        // the blur that ends a committed edit is part of it
        if (resync) resync.answers.push(answer);
    };

    const isMultiline = () => Boolean(local.multiline);
    const generatedId = createUniqueId();
    const fieldId = () => local.id ?? (local.label ? `paper-input-${generatedId}` : undefined);
    const errorId = `paper-input-error-${generatedId}`;
    // the field's own description first, then what is wrong with it
    const describedBy = () => [rest["aria-describedby"], local.error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

    // width:fit-content assumes a single-line field; a textarea should fill the
    // frame it is given, and its resize handle must not be clipped.
    const className = () =>
        cx(
            styles.PaperInput,
            styles[`size-${local.size ?? "medium"}`],
            local.fullWidth ? styles.fullWidth : "",
            icon() ? styles.hasIcon : "",
            local.label ? styles.labelled : "",
            isInvalid() ? styles.invalid : "",
            local.disabled ? styles.disabled : "",
            isMultiline() ? styles.multiline : "",
            isMultiline() && local.resize === false ? styles.fixedSize : "",
        );

    return (
        <div
            class={cx(styles.field, local.fullWidth || isMultiline() ? styles.fullWidth : "", local.class)}
            classList={local.classList}
            data-disabled={local.disabled ? "true" : "false"}
            data-invalid={isInvalid() ? "true" : "false"}
        >
            <div class={className()}>
                <Show when={local.label}>
                    {/* the legend cuts the notch in the border; the visible name is the label */}
                    <fieldset class={styles.outline} aria-hidden="true">
                        <legend>
                            <span>{local.label}</span>
                        </legend>
                    </fieldset>
                    <label class={styles.label} for={fieldId()}>
                        {local.label}
                    </label>
                </Show>
                <Show when={icon()}>
                    {typeof icon() === "string" ? (
                        <PaperIcon class={styles.inputIcon} zeroHeight>
                            {icon()}
                        </PaperIcon>
                    ) : (
                        <span class={styles.inputIcon}>{icon()}</span>
                    )}
                </Show>
                <Show
                    when={isMultiline()}
                    fallback={
                        <input
                            {...rest}
                            id={fieldId()}
                            type={local.type ?? "text"}
                            disabled={local.disabled}
                            ref={local.ref as never}
                            value={currentValue()}
                            aria-invalid={isInvalid() ? "true" : undefined}
                            aria-describedby={describedBy()}
                            onInput={handleInput as never}
                            onChange={handleChange as never}
                            onBlur={handleBlur as never}
                        />
                    }
                >
                    <textarea
                        {...(rest as unknown as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
                        id={fieldId()}
                        rows={local.rows ?? 4}
                        disabled={local.disabled}
                        ref={local.ref as never}
                        value={currentValue()}
                        aria-invalid={isInvalid() ? "true" : undefined}
                        aria-describedby={describedBy()}
                        onInput={handleInput as never}
                        onChange={handleChange as never}
                        onBlur={handleBlur as never}
                    />
                </Show>
            </div>
            <Show when={local.error}>
                <span id={errorId} class={styles.error}>
                    {local.error}
                </span>
            </Show>
        </div>
    );
}
