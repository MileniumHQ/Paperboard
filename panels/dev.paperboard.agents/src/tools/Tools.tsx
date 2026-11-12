// The agent's tools: its MCP servers, as a list like the apps it made, and
// whether it may run other Paperboard panels' actions. A row says how its
// server is doing; sign in, restart, switch off and remove are on the row,
// and choosing it opens the editor. The agent adds servers itself when the
// user asks; this page is also where the user adds or changes one by hand.
// Every change goes to the service, which validates it; a refused change
// says why. Secret values are typed into password fields and go straight to
// the daemon's vault; this page only ever sees their names.

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js";
import {
    PaperButton,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperListLabel,
    PaperLoader,
    PaperModal,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { errorText, failure, type Failure } from "../lib/failure";
import { TOOL_LIMITS, type ServerSpec } from "../toolsContract";
import { createTools, type Tools as ToolsClient } from "./api";
import { blankForm, formFromSpec, newRow, secretNameOf, specFromForm, typedSecrets, type Form, type Row } from "./form";
import SignInSteps from "./SignInSteps";
import { stateOf, stateText, whereText, type ServerState } from "./status";

export default function Tools(props: { agent: Agent }) {
    const tools = createTools();
    // the page before this one stays up until the first read is in
    holdPage(tools.first);
    const name = () => props.agent.state.settings?.name ?? "Your agent";

    return (
        <Switch>
            <Match when={tools.load() === "failed"}>
                <PaperFlex padding="double">
                    <PaperEmptyState icon="error" title="Tools can't be read" description={tools.loadError() ?? undefined}>
                        <PaperButton onClick={() => void tools.refresh()}>Try again</PaperButton>
                    </PaperEmptyState>
                </PaperFlex>
            </Match>
            <Match when={tools.view()}>
                <List tools={tools} name={name()} />
            </Match>
            <Match when={true}>
                <PaperFlex padding="double">
                    <PaperLoader loaderStatus="indeterminate" label="Reading the tools" />
                </PaperFlex>
            </Match>
        </Switch>
    );
}

// a control inside a list item answers for itself, and doesn't choose the item
const own = (e: Event) => e.stopPropagation();

const NEW = "new";
const ACTIONS = "actions";
const rowOf = (server: string) => `server:${server}`;

function List(props: { tools: ToolsClient; name: string }) {
    const view = () => props.tools.view()!;
    const locked = () => view().configError !== null;
    const [form, setForm] = createSignal<Form | null>(null);
    // the editor stays mounted with the last form while it closes, so it animates out instead of vanishing
    const lastForm = createMemo<Form>((prev) => form() ?? prev, blankForm());
    const [removing, setRemoving] = createSignal<ServerSpec | null>(null);
    // a refused removal is told in the confirmation, which stays open over the page
    const [removeError, setRemoveError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<Failure | null>(null);
    // the server whose sign-in is shown, while it's under way
    const [signingIn, setSigningIn] = createSignal<string | null>(null);
    const full = () => view().config.servers.length >= TOOL_LIMITS.servers;

    // finished or ended elsewhere (its card in the chat): the sign-in steps go
    createEffect(() => {
        const s = signingIn();
        if (s && !view().signIns[s]) setSigningIn(null);
    });

    const act = async (title: string, fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(failure(title, e));
        } finally {
            setBusy(false);
        }
    };
    const signIn = (s: ServerSpec) =>
        act("Sign-in not started", async () => {
            await props.tools.signIn(s.name);
            setSigningIn(s.name);
        });
    const setActions = (on: boolean) => act("Panel access not changed", () => props.tools.setActions(on));
    const remove = async (s: ServerSpec) => {
        setBusy(true);
        setRemoveError(null);
        try {
            await props.tools.remove(s.name);
            setRemoving(null);
        } catch (e) {
            setRemoveError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const choose = (value: string) => {
        if (value === NEW) return setForm(blankForm());
        if (value === ACTIONS) return void setActions(!view().config.actions);
        const s = view().config.servers.find((x) => rowOf(x.name) === value);
        if (s) setForm(formFromSpec(s));
    };

    return (
        <>
            <PaperFlex flex minHeight={0}>
                <Show when={view().configError}>
                    <PaperFlex padding="full" gap="half">
                        <PaperQuote variant="danger" icon="error" title="Tools file unreadable" role="alert">
                            {props.name}'s tools file can't be read ({view().configError}). Nothing was changed. Fix or delete tools.json in the panel's config, then try again.
                        </PaperQuote>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => void props.tools.refresh()}>
                                <PaperIcon>refresh</PaperIcon> Try again
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </Show>
                <Show when={error()}>
                    {(shown) => (
                        <PaperFlex padding="full">
                            <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                {shown().message}
                            </PaperQuote>
                        </PaperFlex>
                    )}
                </Show>
                {/* the server being edited is marked */}
                <PaperList name="agents-tools" value={form()?.editing ? rowOf(form()!.name) : ""} onValueChange={(v) => choose(String(v))} borderless fullWidth fullHeight>
                    <PaperListLabel as="h3">Tool servers</PaperListLabel>
                    <For each={view().config.servers}>
                        {(server) => (
                            <ServerRow
                                server={server}
                                state={stateOf(view(), server)}
                                busy={busy() || locked()}
                                onSignIn={() => void signIn(server)}
                                onShowSignIn={() => setSigningIn(server.name)}
                                onEdit={() => setForm(formFromSpec(server))}
                                onRestart={(title) => void act(title, () => props.tools.restart(server.name))}
                                onSwitch={(on) => void act(on ? "Server not switched on" : "Server not switched off", () => props.tools.save({ ...server, enabled: on }))}
                                onRemove={() => {
                                    setRemoveError(null);
                                    setRemoving(server);
                                }}
                            />
                        )}
                    </For>
                    <PaperListItem
                        value={NEW}
                        icon="add"
                        disabled={busy() || locked() || full()}
                        description={full() ? `${props.name} has ${TOOL_LIMITS.servers} servers, the most it can have` : `Or ask ${props.name} to connect a service, like Linear or GitHub`}
                    >
                        Add a server
                    </PaperListItem>
                    <PaperListLabel as="h3">Paperboard</PaperListLabel>
                    <PaperListItem
                        value={ACTIONS}
                        icon="widgets"
                        disabled={busy() || locked()}
                        description={`${props.name} can look up what your other panels can do, like start a game server, and run it`}
                        actions={
                            <PaperFlex onPointerDown={own} onClick={own}>
                                <PaperToggle aria-label="Let it use your other panels" checked={view().config.actions} disabled={busy() || locked()} onChange={(v) => void setActions(v)} />
                            </PaperFlex>
                        }
                    >
                        Let it use your other panels
                    </PaperListItem>
                </PaperList>
            </PaperFlex>

            <Editor tools={props.tools} name={props.name} open={form() !== null} initial={lastForm()} onClose={() => setForm(null)} />

            <PaperModal open={signingIn() !== null} onClose={() => setSigningIn(null)} title={`Sign in to ${signingIn() ?? "the server"}`} size="small">
                <Show when={signingIn()} keyed>
                    {(s) => <SignInSteps tools={props.tools} name={s} />}
                </Show>
            </PaperModal>

            <PaperModal
                open={removing() !== null}
                onClose={() => !busy() && setRemoving(null)}
                title={`Remove ${removing()?.name ?? "this server"}?`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy()} onClick={() => setRemoving(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={() => {
                                const s = removing();
                                if (s) void remove(s);
                            }}
                        >
                            Remove
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex gap="full">
                    <PaperText preset="text">It stops, and the secrets saved for it are deleted. {props.name} can't use its tools anymore.</PaperText>
                    <Show when={removeError()}>
                        <PaperQuote variant="danger" icon="error" title="Server not removed" role="alert">
                            {removeError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}

const RESTART: Partial<Record<ServerState["kind"], string>> = { running: "Restart", failed: "Try again", waiting: "Start now" };

function ServerRow(props: {
    server: ServerSpec;
    state: ServerState;
    busy: boolean;
    onSignIn(): void;
    onShowSignIn(): void;
    onEdit(): void;
    onRestart(title: string): void;
    onSwitch(on: boolean): void;
    onRemove(): void;
}) {
    const s = () => props.server;
    const restart = () => RESTART[props.state.kind];
    return (
        <PaperListItem
            value={rowOf(s().name)}
            disabled={props.busy}
            icon={s().transport === "http" ? "language" : "terminal"}
            loaderStatus={props.state.kind === "starting" ? "indeterminate" : props.state.kind === "failed" ? "error" : undefined}
            description={`${stateText(props.state)} · ${whereText(s())}`}
            actions={
                <PaperFlex direction="row" align="center" gap="onefourth">
                    <Show when={props.state.kind === "needs-sign-in"}>
                        <PaperButton size="small" variant="primary" disabled={props.busy} onPointerDown={own} onClick={(e) => (own(e), props.onSignIn())}>
                            <PaperIcon>login</PaperIcon> Sign in
                        </PaperButton>
                    </Show>
                    <Show when={props.state.kind === "needs-secrets"}>
                        <PaperButton size="small" variant="primary" disabled={props.busy} onPointerDown={own} onClick={(e) => (own(e), props.onEdit())}>
                            <PaperIcon>key</PaperIcon> Add secret
                        </PaperButton>
                    </Show>
                    <Show when={props.state.kind === "signing-in"}>
                        <PaperButton size="small" variant="primary" disabled={props.busy} onPointerDown={own} onClick={(e) => (own(e), props.onShowSignIn())}>
                            <PaperIcon>login</PaperIcon> Continue
                        </PaperButton>
                    </Show>
                    <Show when={restart()}>
                        {(title) => (
                            <PaperButton
                                icon
                                size="small"
                                variant="text"
                                disabled={props.busy}
                                aria-label={`${title()} ${s().name}`}
                                title={title()}
                                onPointerDown={own}
                                onClick={(e) => (own(e), props.onRestart(title() === "Restart" ? "Server not restarted" : "Server not started"))}
                            >
                                <PaperIcon>{title() === "Start now" ? "play_arrow" : "refresh"}</PaperIcon>
                            </PaperButton>
                        )}
                    </Show>
                    <PaperFlex onPointerDown={own} onClick={own}>
                        <PaperToggle aria-label={`${s().name} on`} checked={s().enabled} disabled={props.busy} onChange={(on) => props.onSwitch(on)} />
                    </PaperFlex>
                    <PaperButton icon size="small" variant="text" disabled={props.busy} aria-label={`Remove ${s().name}`} title="Remove" onPointerDown={own} onClick={(e) => (own(e), props.onRemove())}>
                        <PaperIcon>delete</PaperIcon>
                    </PaperButton>
                </PaperFlex>
            }
        >
            {s().name}
        </PaperListItem>
    );
}

function Editor(props: { tools: ToolsClient; name: string; open: boolean; initial: Form; onClose: () => void }) {
    const [f, setF] = createSignal<Form>(props.initial);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<Failure | null>(null);
    // another server (or a new one) to edit: the editor starts from it, with nothing refused yet
    createEffect(
        on(
            () => props.initial,
            (initial) => {
                setF(initial);
                setError(null);
            },
            { defer: true },
        ),
    );
    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
    const setRow = (key: number, patch: Partial<Row>) => setF((cur) => ({ ...cur, rows: cur.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    const http = () => f().transport === "http";
    const saved = (row: Row) => (props.tools.view()?.secrets[f().name.trim()] ?? []).includes(secretNameOf(row.name.trim()));
    const valuesLabel = () => (http() ? "Headers" : "Environment variables");

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            await props.tools.save(specFromForm(f()));
        } catch (e) {
            setError(failure("Server not saved", e));
            setBusy(false);
            return;
        }
        // the server is saved; its secrets go to the vault now
        try {
            for (const s of typedSecrets(f())) await props.tools.setSecret(f().name.trim(), s.name, s.value);
        } catch (e) {
            setError({ title: "Secret not saved", message: `The server was saved, but a secret wasn't: ${errorText(e)} Edit it to add the secret again.` });
            setBusy(false);
            return;
        }
        setBusy(false);
        props.onClose();
    };

    return (
        <PaperModal
            open={props.open}
            onClose={() => !busy() && props.onClose()}
            title={f().editing ? `Edit ${f().name}` : "Add a tool server"}
            size="medium"
            footer={
                <>
                    <PaperButton variant="text" disabled={busy()} onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="primary" disabled={busy()} onClick={() => void save()}>
                        Save
                    </PaperButton>
                </>
            }
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <PaperFlex gap="full">
                    <PaperInput
                        name="name"
                        label="Name"
                        placeholder="github"
                        value={f().name}
                        maxLength={TOOL_LIMITS.name}
                        disabled={f().editing}
                        autofocus={!f().editing}
                        onInput={(e) => set("name", e.currentTarget.value)}
                    />
                    <PaperFlex gap="half">
                        <PaperText preset="heading">
                            Type
                        </PaperText>
                        <PaperSelectMenu
                            name="transport"
                            aria-label="Type"
                            value={f().transport}
                            onValueChange={(v) => setF((cur) => ({ ...cur, transport: v as Form["transport"], rows: [] }))}
                        >
                            <PaperSelectMenuItem value="stdio" icon="terminal" description="A program the server runs for you">
                                Program
                            </PaperSelectMenuItem>
                            <PaperSelectMenuItem value="http" icon="language" description="A server you reach over the web (streamable HTTP)">
                                Web address
                            </PaperSelectMenuItem>
                        </PaperSelectMenu>
                    </PaperFlex>
                    <Show when={!http()}>
                        <PaperInput name="command" label="Program" placeholder="npx" value={f().command} maxLength={TOOL_LIMITS.command} onInput={(e) => set("command", e.currentTarget.value)} />
                        <PaperInput
                            name="args"
                            label="Arguments, one per line"
                            placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/home/me/notes"}
                            multiline
                            rows={4}
                            value={f().args}
                            onInput={(e) => set("args", e.currentTarget.value)}
                        />
                    </Show>
                    <Show when={http()}>
                        <PaperInput name="url" label="Address" placeholder="https://example.com/mcp" value={f().url} maxLength={TOOL_LIMITS.url} onInput={(e) => set("url", e.currentTarget.value)} />
                    </Show>

                    <PaperFlex gap="half">
                        <PaperText preset="heading">
                            {valuesLabel()}
                        </PaperText>
                        <Show when={http()}>
                            <PaperText preset="hint">
                                A secret header holds the whole value, like “Bearer abc123”.
                            </PaperText>
                        </Show>
                        <For each={f().rows}>
                            {(row) => (
                                <PaperFlex direction="row" align="end" gap="half" role="group" aria-label={row.name || valuesLabel()}>
                                    <PaperFlex flex minWidth={0}>
                                        <PaperInput label="Name" value={row.name} maxLength={TOOL_LIMITS.envName} onInput={(e) => setRow(row.key, { name: e.currentTarget.value })} />
                                    </PaperFlex>
                                    <PaperSelectMenu name={`kind-${row.key}`} aria-label="Kind" value={row.kind} onValueChange={(v) => setRow(row.key, { kind: v as Row["kind"], value: "", typed: "" })}>
                                        <PaperSelectMenuItem value="value">Value</PaperSelectMenuItem>
                                        <PaperSelectMenuItem value="secret">Secret</PaperSelectMenuItem>
                                    </PaperSelectMenu>
                                    {/* the value gets the most room: it's what's longest */}
                                    <PaperFlex flex={1.4} minWidth={0}>
                                        <Show
                                            when={row.kind === "secret"}
                                            fallback={<PaperInput label="Value" value={row.value} maxLength={TOOL_LIMITS.envValue} onInput={(e) => setRow(row.key, { value: e.currentTarget.value })} />}
                                        >
                                            <PaperInput
                                                label={saved(row) ? "Secret (saved; type to replace)" : "Secret"}
                                                type="password"
                                                autocomplete="off"
                                                value={row.typed}
                                                maxLength={TOOL_LIMITS.secretValue}
                                                onInput={(e) => setRow(row.key, { typed: e.currentTarget.value })}
                                            />
                                        </Show>
                                    </PaperFlex>
                                    <PaperButton icon variant="text" aria-label={`Remove ${row.name || "this row"}`} title="Remove" onClick={() => set("rows", f().rows.filter((r) => r.key !== row.key))}>
                                        <PaperIcon>close</PaperIcon>
                                    </PaperButton>
                                </PaperFlex>
                            )}
                        </For>
                        <PaperFlex direction="row">
                            <PaperButton disabled={f().rows.length >= (http() ? TOOL_LIMITS.headers : TOOL_LIMITS.env)} onClick={() => set("rows", [...f().rows, newRow()])}>
                                <PaperIcon>add</PaperIcon> Add {http() ? "a header" : "a variable"}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                    <Show when={error()}>
                        {(shown) => (
                            <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                {shown().message}
                            </PaperQuote>
                        )}
                    </Show>
                </PaperFlex>
            </form>
        </PaperModal>
    );
}
