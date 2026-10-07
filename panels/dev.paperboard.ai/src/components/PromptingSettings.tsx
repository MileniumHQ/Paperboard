import { Show } from "solid-js";
import { PaperInput, PaperSelectMenu, PaperSelectMenuItem, PaperSettingItem, PaperSettingList, PaperToggle } from "@mileniumhq/paperui";
import { isPromptStyle, MAX_CUSTOM_PROMPT_CHARS, PROMPT_STYLE_DESCRIPTIONS, PROMPT_STYLE_LABELS, PROMPT_STYLES } from "../core/conversation";
import { createPromptEditor } from "../core/promptEditor";
import type { Settings } from "../core/types";
import styles from "./SettingsView.module.css";

export default function PromptingSettings(props: {
    settings: Settings;
    save: (patch: Partial<Settings>) => Promise<boolean>;
}) {
    const customPrompt = createPromptEditor(
        () => props.settings,
        (value) => props.save({ customSystemPrompt: value }),
    );

    return (
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
            <Show when={props.settings.customPromptEnabled}>
                <PaperSettingItem
                    title="System prompt"
                    description="Used in every chat."
                >
                    <div class={styles.PromptEditor}>
                            <PaperInput
                                multiline
                                fullWidth
                                rows={12}
                                maxLength={MAX_CUSTOM_PROMPT_CHARS}
                                aria-label="System prompt"
                                value={customPrompt.value()}
                                onInput={(event) => customPrompt.update(event.currentTarget.value)}
                            />
                    </div>
                </PaperSettingItem>
            </Show>
        </PaperSettingList>
    );
}
