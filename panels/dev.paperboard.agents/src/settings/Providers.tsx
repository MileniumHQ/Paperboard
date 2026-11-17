// OpenCode's providers: pick one, connect it with a key or a sign-in page,
// or take its credential back. The list and every way to connect come from
// OpenCode itself (service/providers.ts); nothing here names a provider.
// A key goes from its field to OpenCode and is kept nowhere else.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { createPolling, PaperButton, PaperCopyButton, PaperFlex, PaperInput, PaperLink, PaperLoader, PaperModal, PaperError, PaperSelectMenu, PaperSelectMenuItem, PaperText, createAction, createRead, showError } from "@mileniumhq/paperui";
import type { ProviderAttempt, ProviderField, ProviderInfo, ProviderMethod } from "../contract";
import type { Agent } from "../lib/agent";

const POLL_MS = 2_000;

/** A form field is shown unless a field it depends on, as it stands (default included), says otherwise. */
const shown = (field: ProviderField, values: Record<string, string>) =>
    !field.hidden && field.when.every((w) => (w.op === "eq" ? (values[w.key] ?? "") === w.value : (values[w.key] ?? "") !== w.value));

export default function Providers(props: { agent: Agent; open: boolean; onClose: () => void }) {
    // read afresh each time it opens, with nothing refused yet; a re-read (after a connect or a sign-in) changes what differs, and every row and form stays the one it was
    const providers = createRead(() => props.agent.calls.providers(), { source: () => props.open });
    const refetch = providers.reload;
    // a refusal is a toast over the dialog, which stays open to try again
    const action = createAction();
    const busy = action.busy;
    const [selected, setSelected] = createSignal<string>();
    const [key, setKey] = createSignal("");
    const [answers, setAnswers] = createSignal<Record<string, string>>({});
    const [attempt, setAttempt] = createSignal<{ provider: string; info: ProviderAttempt } | null>(null);
    const [code, setCode] = createSignal("");

    const current = (): ProviderInfo | undefined => providers.value()?.find((p) => p.id === selected());

    // a provider chosen afresh: its form starts from its defaults, and nothing typed for another stays
    createEffect(
        on(selected, () => {
            setKey("");
            setCode("");
            setAnswers({});
        }),
    );

    /** each field as it stands: what was answered, else its default */
    const valuesOf = (method: ProviderMethod) => Object.fromEntries(method.fields.map((f) => [f.key, answers()[f.key] ?? f.default ?? ""]));
    const answersFor = (method: ProviderMethod) => {
        const values = valuesOf(method);
        return Object.fromEntries(method.fields.filter((f) => values[f.key] || f.hidden).map((f) => [f.key, values[f.key]!]));
    };
    const incomplete = (method: ProviderMethod) => {
        const values = valuesOf(method);
        return method.fields.some((f) => shown(f, values) && f.required && !values[f.key]);
    };

    const connectKey = (p: ProviderInfo, m: ProviderMethod) =>
        action.run(`Couldn't connect ${p.name}`, async () => {
            await props.agent.calls.connectKey({ provider: p.id, key: key(), answer: answersFor(m) });
            // the key is used once: it doesn't stay in the field
            setKey("");
            await refetch();
        });

    const begin = (p: ProviderInfo, m: ProviderMethod) =>
        action.run(`Couldn't connect ${p.name}`, async () => {
            setAttempt({ provider: p.id, info: await props.agent.calls.beginProvider({ provider: p.id, method: m.id!, answer: answersFor(m) }) });
        });

    const finishAttempt = async (title: string, body: { status: string; message?: string }) => {
        setAttempt(null);
        setCode("");
        if (body.status === "complete") await refetch();
        else if (body.status === "failed") showError(title, body.message ?? "OpenCode didn't say why");
        else if (body.status === "expired") showError(title, "The sign-in page expired. Start again.");
    };
    // an answer for a sign-in that was canceled or replaced since is dropped: it would end the new one with the old one's error
    const check = async (withCode?: string) => {
        const a = attempt();
        if (!a) return;
        const still = () => attempt()?.info.id === a.info.id;
        try {
            const status = await props.agent.calls.providerAttempt({ provider: a.provider, attempt: a.info.id, code: withCode });
            if (still() && status.status !== "pending") await finishAttempt(`Couldn't connect ${current()?.name ?? "the provider"}`, status);
        } catch (e) {
            if (!still()) return;
            setAttempt(null);
            showError(`Couldn't connect ${current()?.name ?? "the provider"}`, e);
        }
    };
    // an automatic sign-in finishes on OpenCode's side: ask until it has, one question at a time
    createPolling(() => (attempt()?.info.mode === "auto" ? check() : undefined), POLL_MS);

    /** resolves whether nothing is left signing in */
    const cancel = async () => {
        const a = attempt();
        setAttempt(null);
        setCode("");
        // run even with nothing to stop: a refusal still on show is of a sign-in that is gone, and a run that goes through takes it away
        return action.run("Couldn't stop signing in", async () => {
            if (a) await props.agent.calls.cancelProvider({ provider: a.provider, attempt: a.info.id });
        });
    };
    // a sign-in under way is stopped first: one OpenCode won't stop keeps the modal open to say so
    const close = async () => {
        if (await cancel()) props.onClose();
    };

    return (
        <PaperModal open={props.open} onClose={() => void close()} title="OpenCode providers" size="medium">
            <PaperFlex gap="full">
                <PaperText preset="hint">
                    OpenCode already has free models. Connect a provider to use its models too.
                </PaperText>
                <Switch>
                    <Match when={providers.value() === undefined && !providers.loading() && providers.error()}>
                        {(err) => <PaperError fill title="Couldn't list the providers" error={err()} action={{ label: "Try again", onClick: () => void refetch() }} />}
                    </Match>
                    <Match when={providers.value() === undefined}>
                        <PaperLoader loaderStatus="indeterminate" label="Asking OpenCode for its providers" />
                    </Match>
                    <Match when={true}>
                        {/* a read again that failed: the providers it had stay, under why */}
                        <Show when={providers.error()}>
                            {(err) => <PaperError title="Couldn't list the providers" error={err()} action={{ label: "Try again", disabled: providers.loading(), onClick: () => void refetch() }} />}
                        </Show>
                        <PaperSelectMenu name="provider" label="Provider" fullWidth searchable value={selected()} onValueChange={(v) => setSelected(String(v))}>
                            <For each={providers.value() ?? []}>
                                {(p) => (
                                    <PaperSelectMenuItem value={p.id} icon={p.connected ? "check_circle" : undefined} description={p.connected ? "Connected" : (p.unsupported ?? undefined)}>
                                        {p.name}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                        <Show when={current()}>
                            {(p) => (
                                <PaperFlex gap="full">
                                    <For each={p().connections}>
                                        {(c) => (
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <PaperText preset="hint">{c.label} is connected.</PaperText>
                                                <PaperButton
                                                    variant="text"
                                                    disabled={busy()}
                                                    onClick={() => void action.run(`Couldn't disconnect ${p().name}`, async () => (await props.agent.calls.disconnectProvider({ credential: c.id }), await refetch()))}
                                                >
                                                    Disconnect
                                                </PaperButton>
                                            </PaperFlex>
                                        )}
                                    </For>
                                    <Show when={p().unsupported}>
                                        <PaperText preset="hint">
                                            {p().unsupported}
                                        </PaperText>
                                    </Show>
                                    <For each={p().methods}>
                                        {(m) => (
                                            <PaperFlex gap="half">
                                                {/* a heading tells the ways to connect apart; one alone would only repeat its field */}
                                                <Show when={p().methods.length > 1}>
                                                    <PaperText preset="section">
                                                        {m.label}
                                                    </PaperText>
                                                </Show>
                                                <For each={m.fields.filter((f) => shown(f, valuesOf(m)))}>
                                                    {(f) => (
                                                        <Show
                                                            when={f.options}
                                                            fallback={
                                                                <PaperInput
                                                                    label={f.title}
                                                                    fullWidth
                                                                    placeholder={f.placeholder ?? undefined}
                                                                    value={valuesOf(m)[f.key]}
                                                                    onInput={(e) => setAnswers({ ...answers(), [f.key]: e.currentTarget.value })}
                                                                />
                                                            }
                                                        >
                                                            {(options) => (
                                                                <PaperSelectMenu
                                                                    name={f.key}
                                                                    label={f.title}
                                                                    fullWidth
                                                                    value={valuesOf(m)[f.key] || undefined}
                                                                    onValueChange={(v) => setAnswers({ ...answers(), [f.key]: String(v) })}
                                                                >
                                                                    <For each={options()}>{(o) => <PaperSelectMenuItem value={o.value} description={o.description ?? undefined}>{o.label}</PaperSelectMenuItem>}</For>
                                                                </PaperSelectMenu>
                                                            )}
                                                        </Show>
                                                    )}
                                                </For>
                                                <Show
                                                    when={m.kind === "key"}
                                                    fallback={
                                                        <PaperFlex direction="row">
                                                            <PaperButton variant="primary" size="large" disabled={busy() || attempt() !== null || incomplete(m)} onClick={() => void begin(p(), m)}>
                                                                Sign in
                                                            </PaperButton>
                                                        </PaperFlex>
                                                    }
                                                >
                                                    <PaperFlex direction="row" gap="half" align="end">
                                                        <PaperFlex grow>
                                                            <PaperInput
                                                                label="API key"
                                                                type="password"
                                                                fullWidth
                                                                autocomplete="off"
                                                                value={key()}
                                                                onInput={(e) => setKey(e.currentTarget.value)}
                                                                onKeyDown={(e) => e.key === "Enter" && key().trim() && !incomplete(m) && void connectKey(p(), m)}
                                                            />
                                                        </PaperFlex>
                                                        <PaperButton variant="primary" size="large" disabled={busy() || !key().trim() || incomplete(m)} onClick={() => void connectKey(p(), m)}>
                                                            Connect
                                                        </PaperButton>
                                                    </PaperFlex>
                                                </Show>
                                            </PaperFlex>
                                        )}
                                    </For>
                                    <Show when={attempt()?.provider === p().id ? attempt() : null}>
                                        {(a) => (
                                            <PaperFlex gap="half">
                                                <PaperText preset="hint">
                                                    {a().info.instructions || "Open the sign-in page and finish there."}
                                                </PaperText>
                                                <PaperFlex direction="row" gap="half" align="center">
                                                    <PaperLink href={a().info.url}>Open the sign-in page</PaperLink>
                                                    <PaperCopyButton text={a().info.url} label="Copy link" variant="text" />
                                                </PaperFlex>
                                                <Show
                                                    when={a().info.mode === "code"}
                                                    fallback={<PaperLoader loaderStatus="indeterminate" label="Waiting for you to finish signing in" />}
                                                >
                                                    <PaperInput label="Code from the page" fullWidth autocomplete="off" value={code()} onInput={(e) => setCode(e.currentTarget.value)} />
                                                    <PaperFlex direction="row" gap="half">
                                                        <PaperButton variant="primary" disabled={!code().trim()} onClick={() => void check(code().trim())}>
                                                            Continue
                                                        </PaperButton>
                                                    </PaperFlex>
                                                </Show>
                                                <PaperFlex direction="row">
                                                    <PaperButton variant="text" onClick={() => void cancel()}>
                                                        Cancel
                                                    </PaperButton>
                                                </PaperFlex>
                                            </PaperFlex>
                                        )}
                                    </Show>
                                </PaperFlex>
                            )}
                        </Show>
                    </Match>
                </Switch>
            </PaperFlex>
        </PaperModal>
    );
}
