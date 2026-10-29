import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import { supports } from "../lib/capabilities";
import { errorMessage } from "../lib/failure";
import { writeServerProperties } from "../lib/properties";
import { selectCustomResourcePack } from "../lib/resourcepack";
import { resourcePackKind, type PackSettings } from "../lib/addons/resourcepack";
import { isResourcePackId, promptToProperty } from "../core/resourcepack";
import AddonBrowser from "./addons/AddonBrowser";
import { createAddonBrowser } from "./addons/state";

const SAVE_DEBOUNCE_MS = 400;

// a value the game would reject is never written: the field says why
const promptProblem = (prompt: string): string => {
    try {
        promptToProperty(prompt);
        return "";
    } catch (err) {
        return errorMessage(err);
    }
};
const idProblem = (id: string): string =>
    isResourcePackId(id) ? "" : "The pack id must be a UUID, like 123e4567-e89b-12d3-a456-426614174000.";
const draftError = (next: PackSettings): string => idProblem(next.id) || promptProblem(next.prompt);

// Resource Pack: one pack at a time in the shared add-on browser, plus every
// server.properties key that belongs to the server resource pack and a
// pasted URL, which only this tab has.
export default function ResourcePack(props: { active: boolean }) {
    const browser = createAddonBrowser({ kind: resourcePackKind, active: () => props.active });
    const [settings, setSettings] = createSignal<PackSettings | null>(null);
    const [saveError, setSaveError] = createSignal("");

    const [customUrl, setCustomUrl] = createSignal("");
    const [hashing, setHashing] = createSignal(false);
    const [customError, setCustomError] = createSignal("");

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    onCleanup(() => {
        if (saveTimer) clearTimeout(saveTimer);
    });

    // what server.properties holds replaces the draft whenever it is read again
    createEffect(on(() => browser.listing()?.meta.settings, (stored) => stored && setSettings({ ...stored })));

    const useCustomUrl = async () => {
        if (hashing()) return;
        setHashing(true);
        setCustomError("");
        try {
            await selectCustomResourcePack(customUrl());
            setCustomUrl("");
            await browser.reload();
        } catch (err) {
            console.error("[Resource Pack] Failed to set the custom URL:", err);
            setCustomError(errorMessage(err));
        } finally {
            setHashing(false);
        }
    };

    const persist = async () => {
        const next = settings();
        if (!next || draftError(next)) return;
        try {
            await writeServerProperties({
                ...(supports("requireResourcePack") ? { "require-resource-pack": String(next.require) } : {}),
                ...(supports("resourcePackPrompt") ? { "resource-pack-prompt": promptToProperty(next.prompt) } : {}),
                ...(supports("resourcePackId") ? { "resource-pack-id": next.id.trim().toLowerCase() } : {}),
            });
            setSaveError("");
        } catch (err) {
            console.error("[Resource Pack] Failed to save the settings:", err);
            setSaveError(errorMessage(err));
        }
    };

    const change = (patch: Partial<PackSettings>, immediate = false) => {
        const next = { ...settings()!, ...patch };
        setSettings(next);
        if (saveTimer) clearTimeout(saveTimer);
        const problem = draftError(next);
        if (problem) {
            setSaveError(problem);
            return;
        }
        setSaveError("");
        if (immediate) void persist();
        else saveTimer = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
    };

    return (
        <AddonBrowser
            browser={browser}
            installExtras={() => (
                <PaperText size={2} color="text-subtle">
                    Players download it from Modrinth when they join.
                </PaperText>
            )}
            notices={
                <>
                    <PaperQuote variant="warning" icon="info" title="Applies after a restart">
                        Players get the pack when they join. A change here reaches them the next time the server starts.
                    </PaperQuote>
                    <Show when={saveError()}>
                        <PaperQuote variant="danger" icon="warning" title="Settings not saved">
                            {saveError()}
                        </PaperQuote>
                    </Show>
                </>
            }
            extras={
                <>
                    <Show when={settings()}>
                        {(values) => (
                            <PaperSettingList autoHeight>
                                <Show when={supports("requireResourcePack")}>
                                    <PaperSettingItem title="Require Resource Pack" description="Players must accept the pack to join.">
                                        <PaperToggle checked={values().require} onChange={(checked) => change({ require: checked }, true)} />
                                    </PaperSettingItem>
                                </Show>
                                <Show when={supports("resourcePackPrompt")}>
                                    <PaperSettingItem
                                        title="Prompt"
                                        description="The message players see when asked to accept the pack. Leave empty for the default."
                                    >
                                        <PaperInput
                                            value={values().prompt}
                                            invalid={promptProblem(values().prompt) !== ""}
                                            onInput={(e) => change({ prompt: e.currentTarget.value })}
                                        />
                                    </PaperSettingItem>
                                </Show>
                                <Show when={supports("resourcePackId")}>
                                    <PaperSettingItem
                                        title="Pack ID"
                                        description="A UUID clients use to tell this pack from others. Leave empty to let the game choose."
                                    >
                                        <PaperInput
                                            value={values().id}
                                            invalid={idProblem(values().id) !== ""}
                                            onInput={(e) => change({ id: e.currentTarget.value })}
                                        />
                                    </PaperSettingItem>
                                </Show>
                            </PaperSettingList>
                        )}
                    </Show>

                    <PaperCard>
                        <PaperFlex direction="column" gap="half" padding="full">
                            <PaperText size={5} weight={700}>
                                Direct URL
                            </PaperText>
                            <PaperInput
                                fullWidth
                                icon="link"
                                placeholder="https://example.com/pack.zip"
                                value={customUrl()}
                                onInput={(e) => setCustomUrl(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") void useCustomUrl();
                                }}
                            />
                            <PaperText size={2} color="text-subtle">
                                Paperboard downloads the pack once to work out its sha1, so players can verify what they get. The link must be
                                a direct download of a .zip.
                            </PaperText>
                            <Show when={customError()}>
                                <PaperQuote variant="danger" icon="warning" title="Resource pack not set">
                                    {customError()}
                                </PaperQuote>
                            </Show>
                            <PaperFlex>
                                <PaperButton variant="success" disabled={hashing() || !customUrl().trim()} onClick={() => void useCustomUrl()}>
                                    <PaperIcon aria-hidden="true">{hashing() ? "hourglass_top" : "check"}</PaperIcon>
                                    {hashing() ? "Downloading…" : "Use this URL"}
                                </PaperButton>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperCard>
                </>
            }
        />
    );
}
