import { createSignal, onMount } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperButton,
    PaperModal,
    PaperQuote,
    PaperSettingList,
    PaperSettingItem,
} from "@paperboard-dev/paperui";
import { config, actionsApi } from "@paperboard-dev/paperapi";

export interface ConfigurationProps {
    onReset?: () => void;
}

export default function Configuration(props: ConfigurationProps) {
    const [showResetModal, setShowResetModal] = createSignal(false);
    const [appId, setAppId] = createSignal("");

    onMount(async () => {
        try {
            const saved = await config.get<any>();
            if (saved?.applicationId) setAppId(saved.applicationId);
        } catch {}
    });

    const handleConfirmReset = async () => {
        try {
            await actionsApi
                .call("dev.paperboard.botcreator", "disconnect-bot")
                .catch(() => {});
            await config.set({
                configured: false,
                token: "",
                applicationId: "",
            });
            setShowResetModal(false);
            props.onReset?.();
        } catch (err) {
            console.error("Failed to reset bot configuration:", err);
        }
    };

    return (
        <>
            <PaperSettingList style={{ height: "auto" }}>
                <PaperSettingItem
                    title="Application ID"
                    description="The Discord Snowflake ID for this bot"
                >
                    <PaperText size={3} color="light-text">
                        {appId() || "Not configured"}
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Bot Token"
                    description="The secret authentication token for the bot"
                >
                    <PaperText size={3} color="light-text">
                        ••••••••••••••••
                    </PaperText>
                </PaperSettingItem>

                <PaperSettingItem
                    title="Reset Configuration"
                    description="Disconnect the bot and delete stored credentials"
                >
                    <PaperButton
                        variant="red"
                        compact
                        onClick={() => setShowResetModal(true)}
                    >
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
                            compact
                            variant="text"
                            onClick={() => setShowResetModal(false)}
                        >
                            Cancel
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="red"
                            onClick={handleConfirmReset}
                        >
                            Confirm Reset
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        Are you sure you want to reset your bot configuration? This will stop the bot and clear stored tokens.
                    </PaperText>
                    <PaperQuote variant="yellow" icon="warning" title="Warning">
                        You will need to enter your bot token again to reconnect.
                    </PaperQuote>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

export { Configuration };
