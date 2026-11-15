// OpenCode's providers: pick one, connect it with a key or a sign-in page,
// or take its credential back. The list and every way to connect come from
// OpenCode itself (service/providers.ts); nothing here names a provider.
// A key goes from its field to OpenCode and is kept nowhere else.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createPolling, PaperButton, PaperCopyButton, PaperFlex, PaperInput, PaperLink, PaperLoader, PaperModal, PaperQuote, PaperSectionHeader, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import type { ProviderAttempt, ProviderField, ProviderInfo, ProviderMethod } from "../contract";
import type { Agent } from "../lib/agent";
import { createAction, createLatest } from "../lib/action";
import { errorText, failure } from "../lib/failure";

const POLL_MS = 2_000;

/** A form field is shown unless a field it depends on, as it stands (default included), says otherwise. */
const shown = (field: ProviderField, values: Record<string, string>) =>
    !field.hidden && field.when.every((w) => (w.op === "eq" ? (values[w.key] ?? "") === w.value : (values[w.key] ?? "") !== w.value));

export default function Providers(props: { agent: Agent; open: boolean; onClose: () => void }) {
    // reconciled by id, so a re-read (after a connect or a sign-in) changes what differs and every row and form stays the one it was
    const [list, setList] = createStore<{ providers: ProviderInfo[] | null }>({ providers: null });
    const [listError, setListError] = createSignal<string | null>(null);
    const { busy, error, setError, run: act } = createAction();
    const latest = createLatest();
    const refetch = async () => {
        const current = latest();
        setListError(null);
        try {
            const next = await props.agent.providers();
            if (current()) setList("providers", reconcile(next, { key: "id" }));
        } catch (e) {
            if (current()) setListError(errorText(e));
        }
    };
    // read afresh each time it opens, with nothing refused yet
    createEffect(
        on(
            () => props.open,
            (open) => {
                if (!open) return;
                setError(null);
                void refetch();
            },
        ),
    );
    const [selected, setSelected] = createSignal<string>();
    const [key, setKey] = createSignal("");
    const [answers, setAnswers] = createSignal<Record<string, string>>({});
    const [attempt, setAttempt] = createSignal<{ provider: string; info: ProviderAttempt } | null>(null);
    const [code, setCode] = createSignal("");

    const current = (): ProviderInfo | undefined => list.providers?.find((p) => p.id === selected());

    // a provider chosen afresh: its form starts from its defaults, and nothing typed for another stays
    createEffect(
        on(selected, () => {
            setKey("");
            setCode("");
            setError(null);
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
        act(`${p.name} not connected`, async () => {
            await props.agent.connectKey(p.id, key(), answersFor(m));
            // the key is used once: it doesn't stay in the field
            setKey("");
            await refetch();
        });

    const begin = (p: ProviderInfo, m: ProviderMethod) =>
        act(`${p.name} not connected`, async () => {
            setAttempt({ provider: p.id, info: await props.agent.beginProvider(p.id, m.id!, answersFor(m)) });
        });

    const finishAttempt = async (title: string, body: { status: string; message?: string }) => {
        setAttempt(null);
        setCode("");
        if (body.status === "complete") await refetch();
        else if (body.status === "failed") setError({ title, message: body.message ?? "OpenCode didn't say why" });
        else if (body.status === "expired") setError({ title, message: "The sign-in page expired. Start again." });
    };
    // an answer for a sign-in that was canceled or replaced since is dropped: it would end the new one with the old one's error
    const check = async (withCode?: string) => {
        const a = attempt();
        if (!a) return;
        const still = () => attempt()?.info.id === a.info.id;
        try {
            const status = await props.agent.providerAttempt(a.provider, a.info.id, withCode);
            if (still() && status.status !== "pending") await finishAttempt(`${current()?.name ?? "Provider"} not connected`, status);
        } catch (e) {
            if (!still()) return;
            setAttempt(null);
            setError(failure(`${current()?.name ?? "Provider"} not connected`, e));
        }
    };
    // an automatic sign-in finishes on OpenCode's side: ask until it has, one question at a time
    createPolling(() => (attempt()?.info.mode === "auto" ? check() : undefined), POLL_MS);

    /** resolves whether nothing is left signing in */
    const cancel = async () => {
        const a = attempt();
        setAttempt(null);
        setCode("");
        return !a || (await act("Sign-in not stopped", () => props.agent.cancelProvider(a.provider, a.info.id)));
    };
    // a sign-in under way is stopped first: one OpenCode won't stop keeps the modal open to say so
    const close = async () => {
        if (await cancel()) props.onClose();
    };

    return (
        <PaperModal open={props.open} onClose={() => void close()} title="OpenCode providers" size="large">
            <PaperFlex gap="full">
                <PaperText preset="hint">
                    OpenCode already has free models. Connect a provider to use its models too.
                </PaperText>
                <Switch>
                    <Match when={listError()}>
                        <PaperQuote variant="danger" icon="error" title="Providers not listed" role="alert">
                            {listError()}
                        </PaperQuote>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => void refetch()}>Look again</PaperButton>
                        </PaperFlex>
                    </Match>
                    <Match when={list.providers === null}>
                        <PaperLoader loaderStatus="indeterminate" label="Asking OpenCode for its providers" />
                    </Match>
                    <Match when={true}>
                        <PaperSelectMenu name="provider" aria-label="Provider" searchable value={selected()} onValueChange={(v) => setSelected(String(v))}>
                            <For each={list.providers ?? []}>
                                {(p) => (
                                    <PaperSelectMenuItem value={p.id} icon={p.connected ? "check_circle" : undefined} description={p.connected ? "Connected" : (p.unsupported ?? undefined)}>
                                        {p.name}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>
                        <Show when={current()}>
                            {(p) => (
                                <PaperFlex gap="half">
                                    <PaperSectionHeader title={p().name} role="heading" aria-level={3} />
                                    <For each={p().connections}>
                                        {(c) => (
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <PaperText preset="hint">{c.label} is connected.</PaperText>
                                                <PaperButton
                                                    variant="text"
                                                    disabled={busy()}
                                                    onClick={() => void act(`${p().name} not disconnected`, async () => (await props.agent.disconnectProvider(c.id), await refetch()))}
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
                                                <PaperText preset="section">
                                                    {m.label}
                                                </PaperText>
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
                                                                    aria-label={f.title}
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
                                                            <PaperButton variant="primary" disabled={busy() || attempt() !== null || incomplete(m)} onClick={() => void begin(p(), m)}>
                                                                Sign in
                                                            </PaperButton>
                                                        </PaperFlex>
                                                    }
                                                >
                                                    <PaperInput
                                                        label="API key"
                                                        type="password"
                                                        fullWidth
                                                        autocomplete="off"
                                                        value={key()}
                                                        onInput={(e) => setKey(e.currentTarget.value)}
                                                        onKeyDown={(e) => e.key === "Enter" && key().trim() && !incomplete(m) && void connectKey(p(), m)}
                                                    />
                                                    <PaperFlex direction="row">
                                                        <PaperButton variant="primary" disabled={busy() || !key().trim() || incomplete(m)} onClick={() => void connectKey(p(), m)}>
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
                        <Show when={error()}>
                            {(shownError) => (
                                <PaperQuote variant="danger" icon="error" title={shownError().title} role="alert">
                                    {shownError().message}
                                </PaperQuote>
                            )}
                        </Show>
                    </Match>
                </Switch>
            </PaperFlex>
        </PaperModal>
    );
}
