// How a block reads: an action's template ("Wait {seconds} seconds") split
// into its words and the inputs that sit between them.
import type { ActionSchema } from "@mileniumhq/paperapi";

export interface TemplateToken {
    type: "text" | "input";
    text?: string;
    key?: string;
    label?: string;
}

export function formatFallbackLabel(key: string): string {
    if (!key) return "";
    return key.charAt(0).toUpperCase() + key.slice(1);
}

// what a template's {key} can name: the action's inputs, plus its output
// under both its type and "output"
export function actionParams(action: ActionSchema | undefined): Record<string, any> {
    const map: Record<string, any> = {
        ...(action?.inputs || {}),
    };
    if (action?.output) {
        if (typeof action.output === "string") {
            map[action.output] = {
                label: formatFallbackLabel(action.output),
                type: action.output,
            };
            map["output"] = { label: "Output", type: action.output };
        } else if (typeof action.output === "object") {
            const outType = (action.output as any).type || "output";
            map[outType] = {
                label: (action.output as any).label || formatFallbackLabel(outType),
                type: outType,
            };
            map["output"] = {
                label: (action.output as any).label || "Output",
                type: outType,
            };
        }
    }
    return map;
}

// with no template, the block reads as its name followed by every param
export function parseTemplateTokens(
    template: string | undefined,
    name: string,
    params: Record<string, any> = {},
): TemplateToken[] {
    if (!template) {
        const tokens: TemplateToken[] = [{ type: "text", text: name }];
        const paramKeys = Object.keys(params);
        if (paramKeys.length > 0) {
            tokens.push({ type: "text", text: " " });
            for (let i = 0; i < paramKeys.length; i++) {
                const k = paramKeys[i];
                tokens.push({
                    type: "input",
                    key: k,
                    label: params[k]?.label || formatFallbackLabel(k),
                });
                if (i < paramKeys.length - 1) {
                    tokens.push({ type: "text", text: " " });
                }
            }
        }
        return tokens;
    }

    const tokens: TemplateToken[] = [];
    const regex = /\{([a-zA-Z0-9_-]+)\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(template)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({
                type: "text",
                text: template.slice(lastIndex, match.index),
            });
        }
        const key = match[1];
        tokens.push({
            type: "input",
            key,
            label: params[key]?.label || formatFallbackLabel(key),
        });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < template.length) {
        tokens.push({
            type: "text",
            text: template.slice(lastIndex),
        });
    }

    return tokens;
}
