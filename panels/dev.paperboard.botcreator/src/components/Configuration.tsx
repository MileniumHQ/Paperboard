import { createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingList,
    PaperSettingItem,
} from "@mileniumhq/paperui";
import { config, secretsApi, actionsApi } from "@mileniumhq/paperapi";
import { errorToMessage } from "../types";

const PANEL_ID = "dev.paperboard.botcreator";
const TOKEN_NAME = "bot-token";

export interface ConfigurationProps {
    onReset?: () => void;
}

export default function Configuration(props: ConfigurationProps) {
    const [showResetModal, setShowResetModal] = createSignal(false);
    const [appId, setAppId] = createSignal("");
    const [readError, setReadError] = createSignal("");
    const [resetting, setResetting] = createSignal(false);
    const [resetError, setResetError] = createSignal("");

    onMount(async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch (err) {
            console.error("[Configuration] app settings read failed:", err);
            setReadError(errorToMessage(err));
        }
    });

    const openReset = () => {
        setResetError("");
        setShowResetModal(true);
    };

    // each step must land before the next: a reset that reports success
    // while the bot still runs, the token stays in the vault, or the saved
    // commands were overwritten is worse than one that stops and says so
    const handleConfirmReset = async () => {
        setResetting(true);
        setResetError("");
        let step = "stop the bot";
        try {
            await actionsApi.call(PANEL_ID, "disconnect-bot");
            // the token lives in the vault, not in config: delete it there.
            // Writing `token: ""` into config would reintroduce the exact
            // plaintext-token field the vault migration removed.
            step = "delete the stored token";
            await secretsApi.delete(TOKEN_NAME, PANEL_ID);
            // saved slash commands are kept: reconnecting registers them
            // again, so the rest of the saved config is read and written back
            step = "read the saved settings";
            const existing = await config.get<Record<string, unknown>>(PANEL_ID);
            if (!existing || typeof existing !== "object") {
                throw new Error("the saved settings are missing");
            }
            step = "save the reset";
            await config.set({
                ...existing,
                configured: false,
                applicationId: "",
            }, PANEL_ID);
            setShowResetModal(false);
            props.onReset?.();
        } catch (err) {
            console.error(`[Configuration] reset failed at "${step}":`, err);
            setResetError(`Couldn't ${step}: ${errorToMessage(err)}`);
        } finally {
            setResetting(false);
        }
    };

    return (
        <>
            <PaperPageHeader
                icon="settings"
                title="Configuration"
                subtitle="Credentials and reset"
            />

            <Show when={readError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read the bot's settings">
                    {readError()}
                </PaperQuote>
            </Show>

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Application ID"
                    description="The Discord Snowflake ID for this bot"
                >
                    <PaperText size={3} color="text-subtle">
                        {appId() || (readError() ? "Unknown" : "Not configured")}
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Bot Token"
                    description="The secret authentication token for the bot"
                >
                    <PaperText size={3} color="text-subtle">
                        ••••••••••••••••
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Reset Configuration"
                    description="Disconnect the bot and delete stored credentials"
                >
                    <PaperButton
                        variant="danger"
                        onClick={openReset}>
                        Reset
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal
                open={showResetModal()}
                onClose={() => setShowResetModal(false)}
                title="Reset bot configuration?"
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setShowResetModal(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={resetting()}
                            onClick={() => void handleConfirmReset()}>
                            {resetting() ? "Resetting…" : "Reset"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Are you sure you want to reset your bot configuration? This will stop the bot and clear stored tokens.
                    </PaperText>
                    <PaperQuote variant="warning" icon="warning" title="You'll need the token again">
                        You will need to enter your bot token again to reconnect.
                        Saved slash commands are kept and register again on reconnect.
                    </PaperQuote>
                    <Show when={resetError()}>
                        <PaperQuote variant="danger" icon="warning" title="Reset incomplete">
                            {resetError()}. Nothing after that step changed; you can try again.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

export { Configuration };
