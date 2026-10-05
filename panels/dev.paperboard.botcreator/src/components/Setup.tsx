import { createSignal, Show } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperTextList,
    PaperWizard,
    PaperWizardStep,
    PaperCenteredInterface,
    PaperLink,
    PaperQuote,
    PaperInput,
} from "@mileniumhq/paperui";
import { config, secretsApi, actionsApi } from "@mileniumhq/paperapi";
import { errorToMessage, extractApplicationIdFromToken } from "../types";

const PANEL_ID = "dev.paperboard.botcreator";
const TOKEN_NAME = "bot-token";

export interface SetupProps {
    onComplete?: () => void;
}

export default function Setup(props: SetupProps) {
    const [token, setToken] = createSignal("");
    const [setupError, setSetupError] = createSignal("");
    const parsedAppId = () => extractApplicationIdFromToken(token());

    const handleFinishSetup = async () => {
        const currentToken = token().trim();
        const appId = parsedAppId();
        if (!currentToken || !appId) return;

        setSetupError("");
        try {
            // token goes to the daemon secret vault; only non-secret state
            // is written to panel config
            await secretsApi.set(TOKEN_NAME, currentToken, PANEL_ID);
            await config.set({
                configured: true,
                applicationId: appId,
            }, PANEL_ID);

            // connect without passing the token — the service reads the vault
            await actionsApi.call(PANEL_ID, "connect-bot");

            props.onComplete?.();
        } catch (err) {
            console.error("[Setup] Failed to save bot configuration:", err);
            // the error stays retryable: the wizard holds its place, the
            // reason renders below, and Finish Setup can be clicked again
            setSetupError(errorToMessage(err));
        }
    };

    return (
        <PaperWizard
            showProgress={false}
            finishLabel="Finish Setup"
            finishVariant="success"
            onComplete={handleFinishSetup}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface>
                    <PaperFlex direction="column" gap="full">
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">Create Discord Application</PaperText>
                            <PaperText preset="body">
                                Create an application in the Discord Developer Portal to get a bot token:
                            </PaperText>
                        </PaperFlex>

                        <PaperTextList ordered spacing="compact">
                            <PaperTextList.Item>
                                Open the Discord Developer Portal using the link below
                            </PaperTextList.Item>
                            <PaperTextList.Item>
                                Click <strong>New Application</strong> and name your bot
                            </PaperTextList.Item>
                            <PaperTextList.Item>
                                Go to the <strong>Bot</strong> tab in the sidebar
                            </PaperTextList.Item>
                            <PaperTextList.Item>
                                Under <strong>Privileged Gateway Intents</strong>, enable{" "}
                                <strong>Message Content Intent</strong> and{" "}
                                <strong>Server Members Intent</strong> so message
                                and member flows receive event data
                            </PaperTextList.Item>
                            <PaperTextList.Item>
                                Click <strong>Reset Token</strong> and copy the token
                            </PaperTextList.Item>
                        </PaperTextList>

                        <PaperQuote>
                            <PaperLink
                                href="https://discord.com/developers/applications"
                                target="_blank"
                            >
                                https://discord.com/developers/applications
                            </PaperLink>
                        </PaperQuote>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={Boolean(parsedAppId())}>
                <PaperCenteredInterface>
                    <PaperFlex direction="column" gap="full">
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title">Configure Bot Token</PaperText>
                            <PaperText preset="body">
                                Paste your bot token below. The Application ID will be parsed automatically.
                            </PaperText>
                        </PaperFlex>

                        <PaperInput
                            fullWidth
                            type="password"
                            placeholder="Paste bot token..."
                            value={token()}
                            onInput={(e) => setToken(e.currentTarget.value)}
                        />

                        <Show when={parsedAppId()}>
                            <PaperQuote variant="success" icon="check_circle">
                                Application ID: {parsedAppId()}
                            </PaperQuote>
                        </Show>

                        <Show when={setupError()}>
                            <PaperQuote variant="danger" icon="warning" title="Setup failed">
                                {setupError()}. Check the token and try again.
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>
        </PaperWizard>
    );
}

export { Setup };
