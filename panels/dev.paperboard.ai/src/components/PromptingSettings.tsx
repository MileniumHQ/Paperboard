import { createEffect, createSignal, Show } from "solid-js";
import { PaperButton, PaperInput, PaperSelectMenu, PaperSelectMenuItem, PaperSettingItem, PaperSettingList, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { isPromptStyle, MAX_CUSTOM_PROMPT_CHARS, PROMPT_STYLE_DESCRIPTIONS, PROMPT_STYLE_LABELS, PROMPT_STYLES } from "../core/conversation";
import type { Settings } from "../core/types";
import styles from "./SettingsView.module.css";

export default function PromptingSettings(props: {
    settings: Settings;
    save: (patch: Partial<Settings>) => Promise<boolean>;
}) {
    const [customPrompt, setCustomPrompt] = createSignal("");
    const [savingPrompt, setSavingPrompt] = createSignal(false);
    createEffect(() => setCustomPrompt(props.settings.customSystemPrompt ?? ""));

    return (
        <>
            <PaperText as="h2" size={4} weight={600}>Prompting</PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Personality"
                    disabled={props.settings.customPromptEnabled}
                    description="How the assistant talks, in every chat."
                >
                    <PaperSelectMenu
                        disabled={props.settings.customPromptEnabled}
                        name="promptStyle"
                        aria-label="Personality"
                        value={props.settings.promptStyle}
                        onValueChange={(value) => {
                            if (isPromptStyle(value)) void props.save({ promptStyle: value });
                        }}
                    >
                        {PROMPT_STYLES.map((style) => (
                            <PaperSelectMenuItem
                                value={style}
                                description={PROMPT_STYLE_DESCRIPTIONS[style]}
                            >
                                {PROMPT_STYLE_LABELS[style]}
                            </PaperSelectMenuItem>
                        ))}
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem
                    title="Custom system prompt"
                    description="Replace the personality prompt with your own instructions."
                >
                    <PaperToggle
                        name="customPromptEnabled"
                        aria-label="Custom system prompt"
                        checked={props.settings.customPromptEnabled}
                        onChange={(on) => void props.save({ customPromptEnabled: on })}
                    />
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={props.settings.customPromptEnabled}>
                <PaperSettingList autoHeight>
                    <PaperSettingItem
                        title="System prompt"
                        description="Used in every chat. Save your edits to apply them."
                    >
                        <div class={styles.PromptEditor}>
                            <PaperInput
                                multiline
                                disabled={savingPrompt()}
                                fullWidth
                                rows={12}
                                maxLength={MAX_CUSTOM_PROMPT_CHARS}
                                aria-label="System prompt"
                                value={customPrompt()}
                                onInput={(event) => setCustomPrompt(event.currentTarget.value)}
                            />
                            <PaperButton
                                disabled={savingPrompt() || customPrompt() === props.settings.customSystemPrompt}
                                onClick={async () => {
                                    setSavingPrompt(true);
                                    try {
                                        await props.save({ customSystemPrompt: customPrompt() });
                                    } finally {
                                        setSavingPrompt(false);
                                    }
                                }}
                            >
                                {savingPrompt() ? "Saving…" : "Save prompt"}
                            </PaperButton>
                        </div>
                    </PaperSettingItem>
                </PaperSettingList>
            </Show>

        </>
    );
}
