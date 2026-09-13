import styles from "./index.module.css";
import {
    splitProps,
    Show,
    createSignal,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";

import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";

export interface PaperCodeProps extends JSX.HTMLAttributes<HTMLElement> {
    block?: boolean;
    language?: string;
    lang?: string;
    copyable?: boolean;
    ref?: HTMLElement | ((el: HTMLElement) => void);
}

function getHighlightedHTML(code: string, lang?: string): string {
    if (!code) return "";
    const language = (lang ?? "tsx").toLowerCase();
    const grammar =
        Prism.languages[language] ||
        Prism.languages.tsx ||
        Prism.languages.typescript ||
        Prism.languages.javascript ||
        Prism.languages.clike;

    if (!grammar) return code;
    try {
        return Prism.highlight(code, grammar, language);
    } catch (err) {
        // graceful degradation (renders unhighlighted), still traced
        console.debug("[PaperCode] highlight failed, rendering plain:", err);
        return code;
    }
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

    const [copied, setCopied] = createSignal(false);

    const getCodeText = (): string => {
        if (typeof local.children === "string") return local.children;
        if (Array.isArray(local.children)) return local.children.join("");
        return String(local.children ?? "");
    };

    const isCopyable = () => local.copyable ?? Boolean(local.block);

    const handleCopy = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const text = getCodeText();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy code to clipboard", err);
        }
    };

    const highlightedHTML = () => {
        const text = getCodeText();
        const effectiveLang = local.language || local.lang;
        return getHighlightedHTML(text, effectiveLang);
    };

    return (
        <Show
            when={local.block}
            fallback={
                <code
                    {...rest}
                    ref={local.ref}
                    class={[styles.PaperCodeInline, local.class]
                        .filter(Boolean)
                        .join(" ")}
                    classList={local.classList}
                    innerHTML={highlightedHTML()}
                />
            }
        >
            <div class={styles.PaperCodeWrapper}>
                <Show when={isCopyable()}>
                    <PaperButton
                        tiny
                        icon
                        class={styles.copyButton}
                        onClick={handleCopy}
                        title={copied() ? "Copied!" : "Copy code"}
                    >
                        <PaperIcon zeroHeight>
                            {copied() ? "check" : "content_copy"}
                        </PaperIcon>
                    </PaperButton>
                </Show>

                <pre
                    {...rest}
                    ref={local.ref as any}
                    class={[styles.PaperCodeBlock, local.class]
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
