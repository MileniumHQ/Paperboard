// Adding a bot, replacing its token and deleting it, the same from the home
// screen and the bot's own pages. Each says what failed, in place, instead
// of closing on an error.
import { createEffect, createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperModal,
    PaperQuote,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";
import { errorToMessage, extractApplicationIdFromToken } from "../types";

const PORTAL_URL = "https://discord.com/developers/applications";

/** The token field and what it says about the token typed into it. */
function TokenField(props: { value: string; onInput: (value: string) => void; appId: string | null; expectedAppId?: string }) {
    return (
        <PaperFlex direction="column" gap="half">
            <PaperInput
                fullWidth
                autofocus
                type="password"
                label="Bot token"
                value={props.value}
                onInput={(e) => props.onInput(e.currentTarget.value)}
            />
            <Show when={props.appId}>
                {(appId) => (
                    <Show
                        when={!props.expectedAppId || props.expectedAppId === appId()}
                        fallback={
                            <PaperQuote variant="danger" icon="error" title="A different bot">
                                This token is for application {appId()}, not this bot ({props.expectedAppId}). Add it as a new bot instead.
                            </PaperQuote>
                        }
                    >
                        <PaperQuote variant="success" icon="check_circle">Application ID: {appId()}</PaperQuote>
                    </Show>
                )}
            </Show>
        </PaperFlex>
    );
}

export function NewBotModal(props: {
    open: boolean;
    onAdd: (token: string) => Promise<{ id: string }>;
    onAdded: (bot: { id: string }) => void;
    onClose: () => void;
}) {
    const [token, setToken] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const appId = () => extractApplicationIdFromToken(token());
    createEffect(() => {
        if (!props.open) return;
        setToken("");
        setError(null);
        setBusy(false);
    });
    const submit = async () => {
        if (busy() || !appId()) return;
        setBusy(true);
        setError(null);
        try {
            const bot = await props.onAdd(token().trim());
            props.onAdded(bot);
            props.onClose();
        } catch (err) {
            setError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="New bot"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="success" disabled={busy() || !appId()} onClick={() => void submit()}>
                        {busy() ? "Connecting…" : "Add bot"}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body">
                        Each bot is its own Discord application. Make one in the{" "}
                        <PaperLink href={PORTAL_URL} target="_blank">Discord Developer Portal</PaperLink>:
                    </PaperText>
                    <PaperTextList ordered spacing="compact">
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
                            Click <strong>Reset Token</strong>, copy the token and paste it here
                        </PaperTextList.Item>
                    </PaperTextList>
                    <TokenField value={token()} onInput={setToken} appId={appId()} />
                    <Show when={error()}>
                        {(text) => (
                            <PaperQuote variant="danger" icon="error" title="Bot not added" role="alert">
                                {text()}
                            </PaperQuote>
                        )}
                    </Show>
                </PaperFlex>
            </form>
        </PaperModal>
    );
}

export function ReplaceTokenModal(props: {
    /** the bot whose token is replaced; closed when null */
    bot: { id: string; name: string; applicationId: string } | null;
    onReplace: (id: string, token: string) => Promise<unknown>;
    onClose: () => void;
}) {
    const [token, setToken] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const appId = () => extractApplicationIdFromToken(token());
    // a token for another application would quietly turn this bot into that one
    const fits = () => Boolean(appId()) && (!props.bot?.applicationId || appId() === props.bot.applicationId);
    createEffect(() => {
        if (!props.bot) return;
        setToken("");
        setError(null);
        setBusy(false);
    });
    const submit = async () => {
        const bot = props.bot;
        if (!bot || busy() || !fits()) return;
        setBusy(true);
        setError(null);
        try {
            await props.onReplace(bot.id, token().trim());
            props.onClose();
        } catch (err) {
            setError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.bot)}
            onClose={props.onClose}
            title="Replace token"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="primary" disabled={busy() || !fits()} onClick={() => void submit()}>Replace</PaperButton>
                </PaperFlex>
            }
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="body">
                        After you reset {props.bot?.name}'s token in the Developer Portal, paste the new one here. Its commands and flows stay as they are.
                    </PaperText>
                    <TokenField value={token()} onInput={setToken} appId={appId()} expectedAppId={props.bot?.applicationId || undefined} />
                    <Show when={error()}>
                        {(text) => <PaperQuote variant="danger" icon="error" title="Token not replaced" role="alert">{text()}</PaperQuote>}
                    </Show>
                </PaperFlex>
            </form>
        </PaperModal>
    );
}

export function DeleteBotModal(props: {
    bot: { id: string; name: string } | null;
    onDelete: (id: string) => Promise<unknown>;
    onClose: () => void;
}) {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(() => {
        if (!props.bot) return;
        setError(null);
        setBusy(false);
    });
    const confirm = async () => {
        const bot = props.bot;
        if (!bot || busy()) return;
        setBusy(true);
        setError(null);
        try {
            await props.onDelete(bot.id);
            props.onClose();
        } catch (err) {
            setError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.bot)}
            onClose={props.onClose}
            title="Delete bot?"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="danger" disabled={busy()} onClick={() => void confirm()}>Delete</PaperButton>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="body">
                    {props.bot?.name} goes offline, and its token and slash commands are deleted from Paperboard.
                    Flows that use it stop working. The application stays in the Discord Developer Portal.
                </PaperText>
                <Show when={error()}>
                    {(text) => <PaperQuote variant="danger" icon="error" title="Not deleted" role="alert">{text()}</PaperQuote>}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
