// The agent's tools: its MCP servers, as a list like the apps it made, and
// whether it may run other Paperboard panels' actions. A row says how its
// server is doing; sign in, restart, switch off and remove are on the row,
// and choosing it opens the editor. The agent adds servers itself when the
// user asks; this page is also where the user adds or changes one by hand.
// Every change goes to the service, which validates it; a refused change
// says why. Secret values are typed into password fields and go straight to
// the daemon's vault; this page only ever sees their names.

import { For, Match, Show, Switch, createComputed, createEffect, createMemo, createSignal, on } from "solid-js";
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
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
    PaperToggle,
    createAction,
    createFailureToast,
    createSavedValue,
    showError,
} from "@mileniumhq/paperui";
import { createStore, reconcile } from "solid-js/store";
import { errorMessage, SerialQueue } from "@mileniumhq/paperapi";
import { toastFailure } from "../lib/toastFailure";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { TOOL_LIMITS, type ServerSpec } from "../toolsContract";
import { createTools, type Tools as ToolsClient } from "./api";
import { blankForm, formFromSpec, newRow, secretOf, specFromForm, typedSecrets, type Form, type Row } from "./form";
import SignInSteps from "./SignInSteps";
import { stateOf, stateText, whereText, type ServerState } from "./status";

export default function Tools(props: { agent: Agent }) {
    const tools = createTools();
    // the page before this one stays up until the first read is in
    holdPage(tools.first);
    const name = () => props.agent.name();

    return (
        <Switch>
            <Match when={tools.load() === "failed"}>
                <PaperFlex padding="double">
                    <PaperEmptyState icon="error" title="Couldn't load">
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
    // a refusal is a toast; a refused removal's shows over the confirmation, which stays open
    const action = createAction();
    const busy = action.busy;
    const act = (title: string, fn: () => Promise<unknown>) => action.run(title, fn, toastFailure);
    createFailureToast(() => view().configError, { title: `Couldn't read ${props.name}'s tools file` });
    // the server whose sign-in is shown, while it's under way
    const [signingIn, setSigningIn] = createSignal<string | null>(null);
    const full = () => view().config.servers.length >= TOOL_LIMITS.servers;

    // finished or ended elsewhere (its card in the chat): the sign-in steps go
    createEffect(
        on([signingIn, () => view().signIns], ([s, signIns]) => {
            if (s && !signIns[s]) setSigningIn(null);
        }),
    );

    const signIn = (s: ServerSpec) =>
        act(`Couldn't start signing in to ${s.name}`, async () => {
            await props.tools.signIn(s.name);
            setSigningIn(s.name);
        });
    // A switch flips at once and its save waits for the ones before it; a refused save puts it back and says why.
    // It isn't held for its save, and neither is anything else on the page.
    const saves = new SerialQueue();
    const switched = (title: string, saving: Promise<void>) => void saving.catch((e) => showError(title, e));
    const actions = createSavedValue(() => view().config.actions, async (on: boolean) => void (await props.tools.setActions(on)), { queue: saves.run });
    const setActions = (on: boolean) => switched("Couldn't change the panels' access", actions.set(on));
    const remove = (s: ServerSpec) =>
        act(`Couldn't remove ${s.name}`, async () => {
            await props.tools.remove(s.name);
            setRemoving(null);
        });

    const choose = (value: string) => {
        if (value === NEW) return setForm(blankForm());
        if (value === ACTIONS) return setActions(!actions.value());
        const s = view().config.servers.find((x) => rowOf(x.name) === value);
        if (s) setForm(formFromSpec(s));
    };

    return (
        <>
            <PaperFlex flex minHeight={0}>
                <Show when={view().configError}>
                    <PaperFlex padding="full" gap="half">
                        <PaperText preset="hint">Nothing was changed. Fix or delete tools.json in the panel's config, then try again.</PaperText>
                        <PaperFlex direction="row">
                            <PaperButton onClick={() => void props.tools.refresh()}>
                                <PaperIcon>refresh</PaperIcon> Try again
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </Show>
                {/* the server being edited is marked */}
                <PaperList name="agents-tools" value={form()?.editing ? rowOf(form()!.name) : ""} onValueChange={(v) => choose(String(v))} borderless fullWidth fullHeight>
                    <PaperListLabel as="h3">Tool servers</PaperListLabel>
                    <For each={view().config.servers}>
                        {(server) => {
                            const enabled = createSavedValue(() => server.enabled, async (on: boolean) => void (await props.tools.save({ ...server, enabled: on })), { queue: saves.run });
                            return (
                                <ServerRow
                                    server={server}
                                    enabled={enabled.value()}
                                    state={stateOf(view(), server)}
                                    busy={busy() || locked()}
                                    locked={locked()}
                                    onSignIn={() => void signIn(server)}
                                    onShowSignIn={() => setSigningIn(server.name)}
                                    onEdit={() => setForm(formFromSpec(server))}
                                    onRestart={(title) => void act(title, () => props.tools.restart(server.name))}
                                    onSwitch={(on) => switched(on ? `Couldn't switch on ${server.name}` : `Couldn't switch off ${server.name}`, enabled.set(on))}
                                    onRemove={() => setRemoving(server)}
                                />
                            );
                        }}
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
                            <PaperToggle aria-label="Let it use your other panels" checked={actions.value()} disabled={locked()} onChange={setActions} />
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
    locked: boolean;
    onSignIn(): void;
    onShowSignIn(): void;
    onEdit(): void;
    onRestart(title: string): void;
    /** whether its switch is on: the change being saved, else what is saved */
    enabled: boolean;
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
                        <PaperButton size="small" variant="primary" disabled={props.busy} onClick={() => props.onSignIn()}>
                            <PaperIcon>login</PaperIcon> Sign in
                        </PaperButton>
                    </Show>
                    <Show when={props.state.kind === "needs-secrets"}>
                        <PaperButton size="small" variant="primary" disabled={props.busy} onClick={() => props.onEdit()}>
                            <PaperIcon>key</PaperIcon> Add secret
                        </PaperButton>
                    </Show>
                    <Show when={props.state.kind === "signing-in"}>
                        <PaperButton size="small" variant="primary" disabled={props.busy} onClick={() => props.onShowSignIn()}>
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
                               
                                onClick={() => props.onRestart(title() === "Restart" ? `Couldn't restart ${s().name}` : `Couldn't start ${s().name}`)}
                            >
                                <PaperIcon>{title() === "Start now" ? "play_arrow" : "refresh"}</PaperIcon>
                            </PaperButton>
                        )}
                    </Show>
                    <PaperButton icon size="small" variant="text" disabled={props.busy} aria-label={`Remove ${s().name}`} title="Remove" onClick={() => props.onRemove()}>
                        <PaperIcon>delete</PaperIcon>
                    </PaperButton>
                    {/* last: every row's switch is on the list's right edge, under the one for the other panels */}
                    <PaperToggle aria-label={`${s().name} on`} checked={props.enabled} disabled={props.locked} onChange={props.onSwitch} />
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
    // the field a refusal was about, marked until the form changes
    const [wrong, setWrong] = createSignal<string | null>(null);
    createEffect(on(f, () => setWrong(null), { defer: true }));
    // another server (or a new one) to edit: the editor starts from it
    createEffect(on(() => props.initial, (initial) => setF(initial), { defer: true }));
    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
    // the rows are a store kept by row.key, so typing in one changes that row in place and nothing remounts
    const [rows, setRows] = createStore<Row[]>([]);
    createComputed(() => setRows(reconcile(f().rows, { key: "key" })));
    const setRow = (key: number, patch: Partial<Row>) => setF((cur) => ({ ...cur, rows: cur.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
    const http = () => f().transport === "http";
    const saved = (row: Row) => (props.tools.view()?.secrets[f().name.trim()] ?? []).includes(secretOf(row));
    const valuesLabel = () => (http() ? "Headers" : "Environment variables");

    let form!: HTMLFormElement;
    const field = (name: string) => form.querySelector<HTMLElement>(`[name="${name}"]`);
    /** the field a refusal is about, from what the form itself shows is wrong; the refusal's own words name anything else */
    const invalid = (): HTMLElement | null => {
        const cur = f();
        const row = cur.rows.find((r) => !r.name.trim() && (r.value || r.typed));
        if (row) return field(`row-name-${row.key}`);
        if (!cur.name.trim()) return field("name");
        if (cur.transport === "http" ? !cur.url.trim() : !cur.command.trim()) return field(cur.transport === "http" ? "url" : "command");
        return null;
    };
    /** says a refusal in a toast over the editor, which stays open, and marks and moves to the field it is about */
    const refused = (title: string, err: unknown, to: boolean) => {
        showError(title, err);
        setBusy(false);
        const at = to ? invalid() : null;
        if (!at) return;
        setWrong(at.getAttribute("name"));
        queueMicrotask(() => at.focus());
    };

    /** the row goes, and focus goes to its neighbour (or to Add, when none is left) instead of dropping to the page */
    const removeRow = (key: number) => {
        const at = f().rows.findIndex((r) => r.key === key);
        const left = f().rows.filter((r) => r.key !== key);
        set("rows", left);
        const next = left[Math.min(at, left.length - 1)];
        queueMicrotask(() => (next ? field(`row-name-${next.key}`) : field("add-row"))?.focus());
    };

    const save = async () => {
        setBusy(true);
        try {
            await props.tools.save(specFromForm(f()));
        } catch (e) {
            console.error("[agents] tool server not saved:", e);
            refused("Couldn't save the server", e, true);
            return;
        }
        // the server is saved; its secrets go to the vault now
        try {
            for (const s of typedSecrets(f())) await props.tools.setSecret(f().name.trim(), s.name, s.value);
        } catch (e) {
            refused("Couldn't save a secret", `The server was saved, but a secret wasn't: ${errorMessage(e)} Edit it to add the secret again.`, false);
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
                ref={form}
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
                        invalid={wrong() === "name" || undefined}
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
                        <PaperInput name="command" label="Program" placeholder="npx" invalid={wrong() === "command" || undefined} value={f().command} maxLength={TOOL_LIMITS.command} onInput={(e) => set("command", e.currentTarget.value)} />
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
                        <PaperInput name="url" label="Address" placeholder="https://example.com/mcp" invalid={wrong() === "url" || undefined} value={f().url} maxLength={TOOL_LIMITS.url} onInput={(e) => set("url", e.currentTarget.value)} />
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
                        <For each={rows}>
                            {(row) => (
                                <PaperFlex direction="row" align="end" gap="half" role="group" aria-label={row.name || valuesLabel()}>
                                    <PaperFlex flex minWidth={0}>
                                        <PaperInput name={`row-name-${row.key}`} label="Name" invalid={wrong() === `row-name-${row.key}` || undefined} value={row.name} maxLength={TOOL_LIMITS.envName} onInput={(e) => setRow(row.key, { name: e.currentTarget.value })} />
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
                                    <PaperButton icon variant="text" aria-label={`Remove ${row.name || "this row"}`} title="Remove" onClick={() => removeRow(row.key)}>
                                        <PaperIcon>close</PaperIcon>
                                    </PaperButton>
                                </PaperFlex>
                            )}
                        </For>
                        <PaperFlex direction="row">
                            <PaperButton name="add-row" disabled={f().rows.length >= (http() ? TOOL_LIMITS.headers : TOOL_LIMITS.env)} onClick={() => set("rows", [...f().rows, newRow()])}>
                                <PaperIcon>add</PaperIcon> Add {http() ? "a header" : "a variable"}
                            </PaperButton>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </form>
        </PaperModal>
    );
}
