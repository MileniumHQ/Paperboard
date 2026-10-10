import { createEffect, createSignal, For, Index, onCleanup, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperModal,
    PaperQuote,
    PaperSwatch,
    getVarCss,
} from "@mileniumhq/paperui";
import {
    applyMotdCode,
    DEFAULT_MOTD,
    joinMotdLines,
    MOTD_COLORS,
    MOTD_FORMATS,
    parseMotd,
    splitMotdLines,
    type MotdSegment,
} from "../core/motd";
import { readServerPropertiesStrict, writeServerProperties } from "../lib/properties";
import { loadServerConfig } from "../lib/server";

// the Multiplayer list is dark in every theme, so its preview is too
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

/** a MOTD with its § codes rendered */
function MotdText(props: { motd: string }) {
    const lines = () => parseMotd(props.motd);
    const [frame, setFrame] = createSignal(0);

    // obfuscated text cycles like it does in game, unless motion is reduced
    createEffect(() => {
        const animated = lines().some((line) => line.some((s) => s.obfuscated));
        if (!animated || reducedMotion()) return;
        const timer = setInterval(() => setFrame((n) => n + 1), OBFUSCATED_FRAME_MS);
        onCleanup(() => clearInterval(timer));
    });

    const segmentStyle = (segment: MotdSegment) => ({
        color: segment.color ?? LIST_GRAY,
        "font-weight": segment.bold ? 700 : undefined,
        "font-style": segment.italic ? "italic" : undefined,
        "text-decoration":
            [segment.underline && "underline", segment.strikethrough && "line-through"]
                .filter(Boolean)
                .join(" ") || undefined,
    });

    return (
        <span style={{ "white-space": "pre" }}>
            <For each={lines()}>
                {(line, index) => (
                    <>
                        <Show when={index() > 0}>
                            <br />
                        </Show>
                        <For each={line}>
                            {(segment) => (
                                <span style={segmentStyle(segment)}>
                                    {segment.obfuscated
                                        ? (frame(), scramble(segment.text))
                                        : segment.text}
                                </span>
                            )}
                        </For>
                    </>
                )}
            </For>
        </span>
    );
}

/** the MOTD as the Multiplayer list draws it: light text on dark, in every theme */
export function MotdPreview(props: { motd: string }) {
    return (
        <div
            style={{
                background: LIST_BACKGROUND,
                padding: `${getVarCss("uigap-onefourth")} ${getVarCss("uigap-half")}`,
                "border-radius": getVarCss("border-radius-half"),
                "font-family": getVarCss("font-family-code"),
                "line-height": 1.4,
                overflow: "hidden",
            }}
        >
            <MotdText motd={props.motd} />
        </div>
    );
}

export function MotdEditor(props: { open: boolean; onClose: () => void }) {
    const [lines, setLines] = createSignal<string[]>(["", ""]);
    const [loaded, setLoaded] = createSignal(false);
    const [loadError, setLoadError] = createSignal(false);
    const [saveError, setSaveError] = createSignal(false);
    const [saving, setSaving] = createSignal(false);
    const inputs: HTMLInputElement[] = [];
    let focusedLine = 0;

    const load = async () => {
        setLoaded(false);
        setLoadError(false);
        setSaveError(false);
        try {
            const values = await readServerPropertiesStrict();
            setLines(splitMotdLines(values.motd ?? DEFAULT_MOTD));
            setLoaded(true);
        } catch (err) {
            console.error("[motd] server.properties read failed:", err);
            setLoadError(true);
        }
    };

    createEffect(() => {
        if (props.open) void load();
    });

    const setLine = (index: number, value: string) =>
        setLines((prev) => prev.map((line, i) => (i === index ? value : line)));

    const applyCode = (code: string) => {
        const input = inputs[focusedLine];
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const next = applyMotdCode(input.value, start, end, code);
        setLine(focusedLine, next.value);
        input.focus();
        input.setSelectionRange(next.caret, next.caret);
    };

    const save = async () => {
        setSaving(true);
        setSaveError(false);
        try {
            await writeServerProperties({ motd: joinMotdLines(lines()) });
            await loadServerConfig();
            props.onClose();
        } catch (err) {
            console.error("[motd] save failed:", err);
            setSaveError(true);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="Server list message"
            size="medium"
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton
                        variant="primary"
                        disabled={!loaded() || saving()}
                        onClick={() => void save()}
                    >
                        Save
                    </PaperButton>
                </PaperFlex>
            }
        >
            <Show
                when={!loadError()}
                fallback={
                    <PaperQuote variant="danger" icon="warning" title="Couldn't read server.properties">
                        <PaperFlex direction="column" gap="half">
                            <span>The message can't be edited until the file can be read.</span>
                            <PaperFlex direction="row">
                                <PaperButton onClick={() => void load()}>Retry</PaperButton>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperQuote>
                }
            >
                <PaperFlex direction="column" gap="full" fullWidth>
                    <MotdPreview motd={joinMotdLines(lines())} />

                    <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                        <For each={MOTD_COLORS}>
                            {(color) => (
                                <PaperButton
                                    size="tiny"
                                    icon
                                    title={color.name}
                                    aria-label={color.name}
                                    disabled={!loaded()}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyCode(color.code)}
                                >
                                    <PaperSwatch color={color.hex} />
                                </PaperButton>
                            )}
                        </For>
                    </PaperFlex>
                    <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                        <For each={MOTD_FORMATS}>
                            {(format) => (
                                <PaperButton
                                    size="tiny"
                                    disabled={!loaded()}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyCode(format.code)}
                                >
                                    {format.name}
                                </PaperButton>
                            )}
                        </For>
                    </PaperFlex>

                    <Index each={lines()}>
                        {(line, index) => (
                            <PaperInput
                                fullWidth
                                aria-label={`Line ${index + 1}`}
                                placeholder={`Line ${index + 1}`}
                                value={line()}
                                disabled={!loaded()}
                                ref={(el) => (inputs[index] = el)}
                                onFocus={() => (focusedLine = index)}
                                onInput={(e) => setLine(index, e.currentTarget.value)}
                            />
                        )}
                    </Index>

                    <Show when={saveError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't save">
                            The message wasn't saved. Try again.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </Show>
        </PaperModal>
    );
}
