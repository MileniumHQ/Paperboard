// The server-list MOTD preview. Kept apart from the editor in Motd.tsx so
// the widget page can draw it without loading the panel's bridge.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { getVarCss } from "@mileniumhq/paperui";
import { MOTD_COLOR_HEX, parseMotd, type MotdStyle } from "../core/motd";

// paper-literal-ok: Minecraft's own list colours, not theme colours. The
// Multiplayer list is dark in every theme, so the MOTD is shown that way
const LIST_BACKGROUND = "#000000";
const LIST_GRAY = "#AAAAAA";
const OBFUSCATED_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const OBFUSCATED_FRAME_MS = 80;

const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.paperuiMotion === "reduced";

function scramble(text: string): string {
    let out = "";
    for (const ch of text) {
        out += ch === " " ? ch : OBFUSCATED_GLYPHS[Math.floor(Math.random() * OBFUSCATED_GLYPHS.length)];
    }
    return out;
}

export const listBox = () => ({
    background: LIST_BACKGROUND,
    padding: `${getVarCss("uigap-onefourth")} ${getVarCss("uigap-half")}`,
    "border-radius": getVarCss("border-radius-half"),
    "font-family": getVarCss("font-family-code"),
    "line-height": getVarCss("leading-normal"),
    "white-space": "pre",
    overflow: "hidden",
});

// obfuscated text scrambles in the preview; in the editor it is blurred so
// the real characters stay editable
export function cssFor(style: MotdStyle, editing: boolean): Record<string, string | undefined> {
    return {
        color: (style.color && MOTD_COLOR_HEX.get(style.color)) || LIST_GRAY,
        "font-weight": style.bold ? getVarCss("weight-bold") : undefined,
        "font-style": style.italic ? "italic" : undefined,
        "text-decoration":
            [style.underline && "underline", style.strikethrough && "line-through"].filter(Boolean).join(" ") ||
            undefined,
        filter: editing && style.obfuscated ? `blur(${getVarCss("uigap-sixth")})` : undefined,
    };
}

/**
 * the MOTD as the Multiplayer list draws it. `paused` stops the obfuscated
 * text's animation (a widget that can't be seen).
 */
export function MotdPreview(props: { motd: string; paused?: boolean; class?: string }) {
    const lines = () => parseMotd(props.motd);
    const [frame, setFrame] = createSignal(0);

    // obfuscated text cycles like it does in game, unless motion is reduced
    createEffect(() => {
        const animated = lines().some((line) => line.some((s) => s.obfuscated));
        if (!animated || props.paused || reducedMotion()) return;
        const timer = setInterval(() => setFrame((n) => n + 1), OBFUSCATED_FRAME_MS);
        onCleanup(() => clearInterval(timer));
    });

    return (
        <div class={props.class} style={listBox()}>
            {/* one block for the text, so a flex or grid box can centre it */}
            <div>
            <For each={lines()}>
                {(line, index) => (
                    <>
                        <Show when={index() > 0}>
                            <br />
                        </Show>
                        <For each={line}>
                            {(segment) => (
                                <span style={cssFor(segment, false)}>
                                    {segment.obfuscated ? (frame(), scramble(segment.text)) : segment.text}
                                </span>
                            )}
                        </For>
                    </>
                )}
            </For>
            </div>
        </div>
    );
}
