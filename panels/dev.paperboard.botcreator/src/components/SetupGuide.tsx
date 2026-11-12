// The first thing a computer with no bots sees: how to make a Discord
// application and get its token, one step at a time, ending in the token
// itself. It shows once; finishing it (a bot is added) or skipping it is
// saved, and every later "New bot" is only the token.
//
// The screenshots are from discord.py's documentation (MIT); see
// assets/portal/CREDITS.md.
import { createSignal, Show, type JSX } from "solid-js";
import { PaperButton, PaperFlex, PaperIcon, PaperQuote, PaperText, PaperWizard, PaperWizardStep } from "@mileniumhq/paperui";
import createApplication from "../assets/portal/1-create-application.webp";
import botTab from "../assets/portal/2-bot-tab.webp";
import resetToken from "../assets/portal/3-reset-token.webp";
import intents from "../assets/portal/4-privileged-intents.webp";
import { PORTAL_URL, TokenField } from "./BotDialogs";
import styles from "./SetupGuide.module.css";
import { errorToMessage, extractApplicationIdFromToken } from "../types";

function Step(props: { title: string; shot: string; alt: string; children: JSX.Element; action?: JSX.Element }) {
    return (
        <PaperFlex direction="column" gap="full" padding="double" fullWidth fullHeight justify="center" align="center">
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperText preset="title" as="h2">{props.title}</PaperText>
                <PaperText preset="body">{props.children}</PaperText>
                {props.action}
            </PaperFlex>
            <img class={styles.shot} src={props.shot} alt={props.alt} />
        </PaperFlex>
    );
}

export default function SetupGuide(props: {
    onAdd: (token: string) => Promise<{ id: string }>;
    onAdded: (bot: { id: string }) => void;
    /** leave the guide: it is saved as seen */
    onSkip: () => void;
}) {
    const [token, setToken] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const appId = () => extractApplicationIdFromToken(token());
    const submit = async () => {
        if (busy() || !appId()) return;
        setBusy(true);
        setError(null);
        try {
            props.onAdded(await props.onAdd(token().trim()));
        } catch (err) {
            setError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <PaperFlex direction="row" align="center" justify="space-between" gap="half" paddingX="double" paddingY="half" fullWidth>
                <PaperText preset="subheader" as="h1">Set up your first bot</PaperText>
                <PaperButton variant="text" size="small" onClick={props.onSkip}>Skip</PaperButton>
            </PaperFlex>
            <PaperFlex flex minHeight={0} fullWidth>
                <PaperWizard finishLabel={busy() ? "Connecting…" : "Add bot"} finishVariant="success" onComplete={() => void submit()}>
                    <PaperWizardStep index={0}>
                        <Step
                            title="Make an application"
                            shot={createApplication}
                            alt="The Discord Developer Portal's Create an Application dialog"
                            action={
                                <PaperFlex>
                                    <PaperButton size="small" variant="outline" href={PORTAL_URL} target="_blank" rel="noreferrer">
                                        <PaperIcon>open_in_new</PaperIcon>
                                        Open the Developer Portal
                                    </PaperButton>
                                </PaperFlex>
                            }
                        >
                            Each bot is its own Discord application. In the Developer Portal, choose New Application, name it and press Create.
                        </Step>
                    </PaperWizardStep>
                    <PaperWizardStep index={1}>
                        <Step title="Open the Bot tab" shot={botTab} alt="The Developer Portal's sidebar with Bot below OAuth2">
                            Choose Bot in the sidebar of your application's settings.
                        </Step>
                    </PaperWizardStep>
                    <PaperWizardStep index={2}>
                        <Step title="Reset the token" shot={resetToken} alt="The Bot tab's token section with the Reset Token button">
                            Press Reset Token, confirm, and copy the token. Discord shows it only once.
                        </Step>
                    </PaperWizardStep>
                    <PaperWizardStep index={3}>
                        <Step title="Turn on the intents" shot={intents} alt="The Privileged Gateway Intents switches for server members and message content">
                            Under Privileged Gateway Intents, switch on Server Members and Message Content, so message and member flows get their events.
                        </Step>
                    </PaperWizardStep>
                    <PaperWizardStep index={4} canProceed={Boolean(appId()) && !busy()}>
                        <PaperFlex direction="column" gap="full" padding="double" fullWidth fullHeight justify="center">
                            <PaperFlex direction="column" gap="half" fullWidth>
                                <PaperText preset="title" as="h2">Paste the token</PaperText>
                                <PaperText preset="body">It's kept in Paperboard's vault, not in the bot's files.</PaperText>
                            </PaperFlex>
                            <TokenField value={token()} onInput={setToken} appId={appId()} />
                            <Show when={error()}>
                                {(text) => (
                                    <PaperQuote variant="danger" icon="error" title="Bot not added" role="alert">{text()}</PaperQuote>
                                )}
                            </Show>
                        </PaperFlex>
                    </PaperWizardStep>
                </PaperWizard>
            </PaperFlex>
        </PaperFlex>
    );
}
