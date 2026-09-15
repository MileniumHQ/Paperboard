import { createSignal, onMount } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingList,
    PaperSettingItem,
} from "@paperboard-dev/paperui";
import { config, secretsApi, actionsApi } from "@paperboard-dev/paperapi";

const PANEL_ID = "dev.paperboard.botcreator";
const TOKEN_NAME = "bot-token";

export interface ConfigurationProps {
    onReset?: () => void;
}

export default function Configuration(props: ConfigurationProps) {
    const [showResetModal, setShowResetModal] = createSignal(false);
    const [appId, setAppId] = createSignal("");

    onMount(async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch (err) { console.error('[Configuration] app settings read failed:', err); }
    });

    const handleConfirmReset = async () => {
        try {
            await actionsApi
                .call("dev.paperboard.botcreator", "disconnect-bot")
                .catch((err) => {
                    console.error("[Configuration] disconnect-bot failed, resetting anyway:", err);
                });
            // the token lives in the vault, not in config: delete it there.
            // Writing `token: ""` into config would reintroduce the exact
            // plaintext-token field the vault migration removed.
            await secretsApi.delete(TOKEN_NAME, PANEL_ID).catch((err) => {
                console.error("[Configuration] vault secret delete failed, resetting anyway:", err);
            });
            // saved slash commands are kept: reconnecting registers them
            // again, and silently dropping them while Discord still has
            // them would be a record that disagrees with the code
            let saved: Record<string, unknown> = {};
            try {
                const existing = await config.get<Record<string, unknown>>(PANEL_ID);
                if (existing && typeof existing === "object") saved = existing;
            } catch (err) {
                console.error(
                    "[Configuration] saved config unreadable during reset; commands may be lost:",
                    err,
                );
            }
            await config.set({
                ...saved,
                configured: false,
                applicationId: "",
            }, PANEL_ID);
            setShowResetModal(false);
            props.onReset?.();
        } catch (err) {
            console.error("Failed to reset bot configuration:", err);
        }
    };

    return (
        <>
            <PaperPageHeader
                icon="settings"
                title="Configuration"
                subtitle="Credentials and reset"
            />

            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Application ID"
                    description="The Discord Snowflake ID for this bot"
                >
                    <PaperText size={3} color="text-subtle">
                        {appId() || "Not configured"}
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
                        onClick={() => setShowResetModal(true)}>
                        Reset
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>

            <PaperModal
                open={showResetModal()}
                onClose={() => setShowResetModal(false)}
                title="Reset Bot Configuration"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton
                            variant="text"
                            onClick={() => setShowResetModal(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={handleConfirmReset}>
                            Confirm Reset
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Are you sure you want to reset your bot configuration? This will stop the bot and clear stored tokens.
                    </PaperText>
                    <PaperQuote variant="warning" icon="warning" title="Warning">
                        You will need to enter your bot token again to reconnect.
                        Saved slash commands are kept and register again on reconnect.
                    </PaperQuote>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

export { Configuration };
