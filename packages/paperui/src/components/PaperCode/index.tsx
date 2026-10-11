import styles from "./index.module.css";
import {
    splitProps,
    Show,
    createSignal,
    onCleanup,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { copyText } from "../../utils/clipboard";

import { highlightCode } from "../../utils/highlight";
import tokens from "../shared/codeTokens.module.css";

export interface PaperCodeProps extends JSX.HTMLAttributes<HTMLElement> {
    block?: boolean;
    language?: string;
    lang?: string;
    copyable?: boolean;
    ref?: HTMLElement | ((el: HTMLElement) => void);
}

export function PaperCode(props: ParentProps<PaperCodeProps>) {
    const [local, rest] = splitProps(props, [
        "block",
        "language",
        "lang",
        "copyable",
        "class",
        "classList",
        "children",
        "ref",
    ]);

    const [copied, setCopied] = createSignal<"idle" | "copied" | "failed">("idle");
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(resetTimer));

    const getCodeText = (): string => {
        if (typeof local.children === "string") return local.children;
        if (Array.isArray(local.children)) return local.children.join("");
        return String(local.children ?? "");
    };

    const isCopyable = () => local.copyable ?? Boolean(local.block);

    const handleCopy = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // copyText falls back to execCommand where the async clipboard is
        // denied (sandboxed panel frames), and reports failure honestly
        setCopied((await copyText(getCodeText())) ? "copied" : "failed");
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => setCopied("idle"), 2000);
    };

    const highlightedHTML = () => {
        const text = getCodeText();
        const effectiveLang = local.language || local.lang;
        return highlightCode(text, effectiveLang);
    };

    return (
        <Show
            when={local.block}
            fallback={
                <code
                    {...rest}
                    ref={local.ref}
                    class={[styles.PaperCodeInline, tokens.tokens, local.class]
                        .filter(Boolean)
                        .join(" ")}
                    classList={local.classList}
                    innerHTML={highlightedHTML()}
                />
            }
        >
            <div
                class={styles.PaperCodeWrapper}
                classList={{ [styles.copyable]: isCopyable() }}
            >
                <Show when={isCopyable()}>
                    <PaperButton
                        size="tiny"
                        icon
                        class={styles.copyButton}
                        onClick={handleCopy}
                        aria-label={
                            copied() === "copied"
                                ? "Copied"
                                : copied() === "failed"
                                  ? "Copy failed"
                                  : "Copy code"
                        }
                        title={
                            copied() === "copied"
                                ? "Copied"
                                : copied() === "failed"
                                  ? "Copy failed"
                                  : "Copy code"
                        }
                    >
                        <PaperIcon>
                            {copied() === "copied"
                                ? "check"
                                : copied() === "failed"
                                  ? "error"
                                  : "content_copy"}
                        </PaperIcon>
                    </PaperButton>
                </Show>

                <pre
                    {...rest}
                    ref={local.ref as any}
                    class={[styles.PaperCodeBlock, tokens.tokens, local.class]
                        .filter(Boolean)
                        .join(" ")}
                    classList={local.classList}
                >
                    <code innerHTML={highlightedHTML()} />
                </pre>
            </div>
        </Show>
    );
}
