// The server-list MOTD preview. Kept apart from the editor in Motd.tsx so
// the widget page can draw it without loading the panel's bridge.
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { MOTD_COLOR_HEX, parseMotd, type MotdStyle } from "../core/motd";
import styles from "./Motd.module.css";

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

/** the classes that draw one run of MOTD text; `editing` blurs obfuscated text */
export function motdClasses(style: MotdStyle, editing: boolean): string {
    return [
        style.color && MOTD_COLOR_HEX.has(style.color) ? styles[`color-${style.color}`] : styles.plain,
        style.bold && styles.bold,
        style.italic && styles.italic,
        style.underline && styles.underline,
        style.strikethrough && styles.strikethrough,
        editing && style.obfuscated && styles.blurred,
    ]
        .filter(Boolean)
        .join(" ");
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
        <div class={[styles.listBox, props.class].filter(Boolean).join(" ")}>
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
                                <span class={motdClasses(segment, false)}>
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
