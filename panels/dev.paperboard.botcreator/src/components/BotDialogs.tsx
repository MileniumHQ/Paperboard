// Adding a bot, replacing its token and deleting it, the same from the home
// screen and the bot's own pages. Each stays open until the service has
// answered, and on an error: a token's is said under the token, a delete's
// in a toast.
import { createEffect, createSignal, on, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperModal,
    PaperQuote,
    PaperText,
    showError,
} from "@mileniumhq/paperui";
import type { DeleteBotResult } from "../bots";
import { extractApplicationIdFromToken } from "../types";
import { errorMessage } from "@mileniumhq/paperapi";

export const PORTAL_URL = "https://discord.com/developers/applications";

/**
 * The token field and what it says about the token typed into it: that it
 * isn't one, that it names another bot, or `error`, why the service refused it.
 */
export function TokenField(props: { value: string; onInput: (value: string) => void; appId: string | null; expectedAppId?: string; error?: string | null }) {
    // what is wrong with the token, before the service is asked and after
    const problem = () => {
        if (props.value.trim() && !props.appId)
            return "That isn't a bot token. A bot token is a long line of three parts joined by dots, the first of which names the bot. Copy all of it from the Bot tab of your application in the Developer Portal; Reset Token shows it again.";
        if (props.appId && props.expectedAppId && props.expectedAppId !== props.appId)
            return `This token is for application ${props.appId}, not this bot (${props.expectedAppId}). Add it as a new bot instead.`;
        return props.error ?? null;
    };
    return (
        <PaperFlex direction="column" gap="half">
            <PaperInput
                fullWidth
                autofocus
                type="password"
                label="Bot token"
                value={props.value}
                error={problem() ?? undefined}
                onInput={(e) => props.onInput(e.currentTarget.value)}
            />
            <Show when={props.appId && (!props.expectedAppId || props.expectedAppId === props.appId) ? props.appId : null}>
                {/* read from the token, not checked with Discord: named, never shown as good */}
                {(appId) => <PaperText preset="hint">Application ID: {appId()}</PaperText>}
            </Show>
        </PaperFlex>
    );
}

/**
 * A bot added from a token typed in: the token, the application it names,
 * and the add, whose refusal the token field says. The New bot dialog and
 * the setup guide both add bots this way.
 */
export function createAddBot(onAdd: (token: string) => Promise<{ id: string }>, onAdded: (bot: { id: string }) => void) {
    const [token, setToken] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const appId = () => extractApplicationIdFromToken(token());
    const submit = async () => {
        if (busy() || !appId()) return;
        setBusy(true);
        setError(null);
        try {
            onAdded(await onAdd(token().trim()));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const reset = () => {
        setToken("");
        setError(null);
        setBusy(false);
    };
    // the refusal was of the token typed before
    const type = (value: string) => {
        setToken(value);
        setError(null);
    };
    return { token, setToken: type, busy, error, appId, submit, reset };
}

export function NewBotModal(props: {
    open: boolean;
    onAdd: (token: string) => Promise<{ id: string }>;
    onAdded: (bot: { id: string }) => void;
    onClose: () => void;
}) {
    const { token, setToken, busy, error, appId, submit, reset } = createAddBot(
        (value) => props.onAdd(value),
        (bot) => {
            props.onAdded(bot);
            props.onClose();
        },
    );
    // what was asked can't be taken back: the dialog stays for its answer
    const close = () => {
        if (!busy()) props.onClose();
    };
    // each opening starts empty
    createEffect(on(() => props.open, (open) => {
        if (open) reset();
    }));
    return (
        <PaperModal
            open={props.open}
            onClose={close}
            title="New bot"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" disabled={busy()} onClick={close}>Cancel</PaperButton>
                    <PaperButton variant="success" disabled={busy() || !appId()} onClick={() => void submit()}>
                        {busy() ? "Connecting…" : "Add bot"}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="text">
                        Paste the token from your bot's page in the{" "}
                        <PaperLink href={PORTAL_URL} target="_blank">Discord Developer Portal</PaperLink>.
                    </PaperText>
                    <TokenField value={token()} onInput={setToken} appId={appId()} error={error()} />
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
    // what was asked can't be taken back: the dialog stays for its answer
    const close = () => {
        if (!busy()) props.onClose();
    };
    const appId = () => extractApplicationIdFromToken(token());
    // the refusal was of the token typed before
    const type = (value: string) => {
        setToken(value);
        setError(null);
    };
    // a token for another application would quietly turn this bot into that one
    const fits = () => Boolean(appId()) && (!props.bot?.applicationId || appId() === props.bot.applicationId);
    // opened for a bot, it starts empty: a change to the bot while it is open keeps what was typed
    createEffect(on(() => props.bot?.id, (id) => {
        if (!id) return;
        setToken("");
        setError(null);
        setBusy(false);
    }));
    const submit = async () => {
        const bot = props.bot;
        if (!bot || busy() || !fits()) return;
        setBusy(true);
        setError(null);
        try {
            await props.onReplace(bot.id, token().trim());
            props.onClose();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.bot)}
            onClose={close}
            title="Replace token"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" disabled={busy()} onClick={close}>Cancel</PaperButton>
                    <PaperButton variant="primary" disabled={busy() || !fits()} onClick={() => void submit()}>Replace</PaperButton>
                </PaperFlex>
            }
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="text">
                        After you reset {props.bot?.name}'s token in the Developer Portal, paste the new one here. Its commands and flows stay as they are.
                    </PaperText>
                    <TokenField value={token()} onInput={type} appId={appId()} expectedAppId={props.bot?.applicationId || undefined} error={error()} />
                </PaperFlex>
            </form>
        </PaperModal>
    );
}

export function DeleteBotModal(props: {
    bot: { id: string; name: string; hasToken: boolean; commands: readonly unknown[] } | null;
    onDelete: (id: string, anyway: boolean) => Promise<DeleteBotResult>;
    onClose: () => void;
}) {
    const [busy, setBusy] = createSignal(false);
    // why Discord kept its commands: Delete anyway removes the bot regardless
    const [refused, setRefused] = createSignal<string | null>(null);
    // what was asked can't be taken back: the dialog stays for its answer
    const close = () => {
        if (!busy()) props.onClose();
    };
    createEffect(on(() => props.bot?.id, (id) => {
        if (!id) return;
        setRefused(null);
        setBusy(false);
    }));
    const confirm = async () => {
        const bot = props.bot;
        if (!bot || busy()) return;
        const anyway = refused() !== null;
        setBusy(true);
        try {
            const result = await props.onDelete(bot.id, anyway);
            if ("refused" in result) setRefused(result.refused);
            else props.onClose();
        } catch (err) {
            showError(`Couldn't delete ${bot.name}`, err);
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperModal
            open={Boolean(props.bot)}
            onClose={close}
            title="Delete bot?"
            size="small"
            footer={
                <PaperFlex direction="row" gap="half" justify="end" fullWidth>
                    <PaperButton variant="text" disabled={busy()} onClick={close}>Cancel</PaperButton>
                    <PaperButton variant="danger" disabled={busy()} onClick={() => void confirm()}>
                        {refused() === null ? "Delete" : "Delete anyway"}
                    </PaperButton>
                </PaperFlex>
            }
        >
            <PaperFlex direction="column" gap="half">
                <PaperText preset="text">
                    {props.bot?.hasToken && props.bot.commands.length > 0
                        ? `${props.bot.name}'s slash commands are removed from Discord, it goes offline, and`
                        : `${props.bot?.name} goes offline and`} its token is deleted from Paperboard.
                    Flows that use it stop working. The application stays in the Discord Developer Portal.
                </PaperText>
                <Show when={refused()}>
                    {(why) => (
                        <PaperQuote variant="warning" icon="cloud_off" title="Discord kept its slash commands" role="alert">
                            Discord said "{why()}". Delete anyway removes the bot from Paperboard, and its slash commands stay on Discord.
                        </PaperQuote>
                    )}
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
