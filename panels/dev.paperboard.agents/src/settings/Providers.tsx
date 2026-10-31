// OpenCode's providers: pick one, connect it with a key or a sign-in page,
// or take its credential back. The list and every way to connect come from
// OpenCode itself (service/providers.ts); nothing here names a provider.
// A key goes from its field to OpenCode and is kept nowhere else.

import { For, Match, Show, Switch, createEffect, createResource, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperCopyButton, PaperFlex, PaperInput, PaperLink, PaperLoader, PaperModal, PaperQuote, PaperSectionHeader, PaperSelectMenu, PaperSelectMenuItem, PaperText } from "@mileniumhq/paperui";
import type { ProviderAttempt, ProviderField, ProviderInfo, ProviderMethod } from "../contract";
import type { Agent } from "../lib/agent";
import { failure, type Failure } from "../lib/failure";

const POLL_MS = 2_000;

/** A form field is shown unless a field it depends on says otherwise. */
const shown = (field: ProviderField, answers: Record<string, string>) =>
    !field.hidden && field.when.every((w) => (w.op === "eq" ? (answers[w.key] ?? "") === w.value : (answers[w.key] ?? "") !== w.value));

export default function Providers(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const { agent } = props;
    const [providers, { refetch }] = createResource(
        () => props.open || undefined,
        () => agent.providers(),
    );
    const [selected, setSelected] = createSignal<string>();
    const [error, setError] = createSignal<Failure | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [key, setKey] = createSignal("");
    const [answers, setAnswers] = createSignal<Record<string, string>>({});
    const [attempt, setAttempt] = createSignal<{ provider: string; info: ProviderAttempt } | null>(null);
    const [code, setCode] = createSignal("");

    const current = (): ProviderInfo | undefined => providers.latest?.find((p) => p.id === selected());

    // a provider chosen afresh: its form starts from its defaults, and nothing typed for another stays
    createEffect(
        on(selected, () => {
            setKey("");
            setCode("");
            setError(null);
            setAnswers({});
        }),
    );

    const act = async (title: string, run: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await run();
        } catch (e) {
            setError(failure(title, e));
        } finally {
            setBusy(false);
        }
    };

    const answersFor = (method: ProviderMethod): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const f of method.fields) {
            const value = answers()[f.key] ?? f.default ?? "";
            if (value || f.hidden) out[f.key] = value;
        }
        return out;
    };
    const incomplete = (method: ProviderMethod) => method.fields.some((f) => shown(f, { ...answers() }) && f.required && !(answers()[f.key] ?? f.default));

    const connectKey = (p: ProviderInfo, m: ProviderMethod) =>
        act(`${p.name} not connected`, async () => {
            await agent.connectKey(p.id, key(), answersFor(m));
            // the key is used once: it doesn't stay in the field
            setKey("");
            await refetch();
        });

    const begin = (p: ProviderInfo, m: ProviderMethod) =>
        act(`${p.name} not connected`, async () => {
            setAttempt({ provider: p.id, info: await agent.beginProvider(p.id, m.id!, answersFor(m)) });
        });

    const finishAttempt = async (title: string, body: { status: string; message?: string }) => {
        setAttempt(null);
        setCode("");
        if (body.status === "complete") await refetch();
        else if (body.status === "failed") setError({ title, message: body.message ?? "OpenCode didn't say why" });
        else if (body.status === "expired") setError({ title, message: "The sign-in page expired. Start again." });
    };
    const check = async (withCode?: string) => {
        const a = attempt();
        if (!a) return;
        try {
            const status = await agent.providerAttempt(a.provider, a.info.id, withCode);
            if (status.status !== "pending") await finishAttempt(`${current()?.name ?? "Provider"} not connected`, status);
        } catch (e) {
            setAttempt(null);
            setError(failure(`${current()?.name ?? "Provider"} not connected`, e));
        }
    };
    // an automatic sign-in finishes on OpenCode's side: ask until it has
    const timer = setInterval(() => {
        if (attempt() && attempt()!.info.mode === "auto") void check();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));

    const cancel = async () => {
        const a = attempt();
        setAttempt(null);
        setCode("");
        if (a) await act("Sign-in not stopped", () => agent.cancelProvider(a.provider, a.info.id));
    };
    const close = () => {
        void cancel();
        props.onClose();
    };

    return (
        <PaperModal open={props.open} onClose={close} title="OpenCode providers" size="large">
            <PaperFlex gap="full">
                <PaperText preset="hint">
                    OpenCode already has free models. Connect a provider to use its models too.
                </PaperText>
                <Switch>
                    <Match when={providers.error}>
                        <PaperQuote variant="danger" icon="error" title="Providers not listed" role="alert">
                            {failure("", providers.error).message}
                        </PaperQuote>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => void refetch()}>Look again</PaperButton>
                        </PaperFlex>
                    </Match>
                    <Match when={providers.loading && !providers.latest}>
                        <PaperLoader loaderStatus="indeterminate" label="Asking OpenCode for its providers" />
                    </Match>
                    <Match when={true}>
                        <PaperSelectMenu name="provider" aria-label="Provider" searchable value={selected()} onValueChange={(v) => setSelected(String(v))}>
                            <For each={providers.latest ?? []}>
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
                                                    onClick={() => void act(`${p().name} not disconnected`, async () => (await agent.disconnectProvider(c.id), await refetch()))}
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
                                                <For each={m.fields.filter((f) => shown(f, answers()))}>
                                                    {(f) => (
                                                        <Show
                                                            when={f.options}
                                                            fallback={
                                                                <PaperInput
                                                                    label={f.title}
                                                                    fullWidth
                                                                    placeholder={f.placeholder ?? undefined}
                                                                    value={answers()[f.key] ?? f.default ?? ""}
                                                                    onInput={(e) => setAnswers({ ...answers(), [f.key]: e.currentTarget.value })}
                                                                />
                                                            }
                                                        >
                                                            {(options) => (
                                                                <PaperSelectMenu
                                                                    name={f.key}
                                                                    aria-label={f.title}
                                                                    value={answers()[f.key] ?? f.default ?? undefined}
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
