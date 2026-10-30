// The composer's text field: a token-styled textarea, not PaperInput. The
// box around it is the composer's own surface, so this contributes no frame;
// it grows with the content up to a bound.
import { createEffect } from "solid-js";
import styles from "./MessageInput.module.css";

const MAX_HEIGHT = `calc(var(--paper-uigap) * 12)`;

export interface MessageInputProps {
    value: string;
    disabled?: boolean;
    placeholder?: string;
    onInput: (value: string) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onPaste?: (e: ClipboardEvent) => void;
    ref?: (el: HTMLTextAreaElement) => void;
}

export default function MessageInput(props: MessageInputProps) {
    let el: HTMLTextAreaElement | undefined;

    const resize = () => {
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `min(${el.scrollHeight}px, ${MAX_HEIGHT})`;
    };

    // value can change from the outside (a sent message clears it)
    createEffect(() => {
        void props.value;
        queueMicrotask(resize);
    });

    return (
        <textarea
            ref={(node) => {
                el = node;
                props.ref?.(node);
            }}
            class={styles.MessageInput}
            rows={1}
            value={props.value}
            disabled={props.disabled}
            placeholder={props.placeholder}
            aria-label="Message"
            onInput={(e) => {
                props.onInput(e.currentTarget.value);
                resize();
            }}
            onKeyDown={(e) => props.onKeyDown?.(e)}
            onPaste={(e) => props.onPaste?.(e)}
        />
    );
}
