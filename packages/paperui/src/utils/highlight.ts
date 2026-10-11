import Prism from "./prismCore";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-json5";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-properties";
import "prismjs/components/prism-markdown";

// The one place PaperUI loads Prism and its grammars. PaperCode renders a
// highlighted string; PaperEditor needs the same tokens split into lines so
// each line can sit in its own row beside its line number.

/** the grammar for a language id, or null when PaperUI has none for it */
export function grammarFor(language: string | undefined): Prism.Grammar | null {
    if (!language) return null;
    return Prism.languages[language.toLowerCase()] ?? null;
}

/**
 * Highlighted HTML for PaperCode. An unknown language falls back to TSX so
 * snippets without a language still get some colour.
 */
export function highlightCode(code: string, lang?: string): string {
    if (!code) return "";
    const language = (lang ?? "tsx").toLowerCase();
    const grammar =
        Prism.languages[language] ||
        Prism.languages.tsx ||
        Prism.languages.typescript ||
        Prism.languages.javascript ||
        Prism.languages.clike;

    if (!grammar) return escapeHtml(code);
    try {
        return Prism.highlight(code, grammar, language);
    } catch (err) {
        // graceful degradation (renders unhighlighted), still traced
        console.debug("[PaperCode] highlight failed, rendering plain:", err);
        return escapeHtml(code);
    }
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (ch) =>
        ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
    );
}

function tokenClass(token: Prism.Token): string {
    const aliases = token.alias ? (Array.isArray(token.alias) ? token.alias : [token.alias]) : [];
    return escapeHtml(["token", token.type, ...aliases].join(" "));
}

/**
 * One HTML string per line of `text` (split on "\n", so the count always
 * matches the text's lines). A token that spans lines is closed at the end
 * of each line and reopened on the next, so every line is valid HTML on its
 * own. Returns null when the language has no grammar.
 */
export function highlightLines(text: string, language: string | undefined): string[] | null {
    const grammar = grammarFor(language);
    if (!grammar) return null;
    const lines: string[] = [];
    const open: string[] = [];
    let line = "";

    const emit = (chunk: string) => {
        const parts = chunk.split("\n");
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                lines.push(line + "</span>".repeat(open.length));
                line = open.map((cls) => `<span class="${cls}">`).join("");
            }
            line += escapeHtml(parts[i]!);
        }
    };
    const walk = (node: string | Prism.Token | Prism.TokenStream) => {
        if (typeof node === "string") return emit(node);
        if (Array.isArray(node)) {
            for (const child of node) walk(child);
            return;
        }
        const cls = tokenClass(node as Prism.Token);
        open.push(cls);
        line += `<span class="${cls}">`;
        walk((node as Prism.Token).content);
        line += "</span>";
        open.pop();
    };

    walk(Prism.tokenize(text, grammar));
    lines.push(line);
    return lines;
}
