// The agent's tools: the MCP servers it can use (on this computer, or inside
// its own) and whether it may run other Paperboard panels' actions. Every
// change goes to the service, which validates it; a refused change says why.
// Secret values are typed into password fields and go straight to the
// daemon's vault; this page only ever sees their names.

import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLoader,
    PaperModal,
    PaperQuote,
    PaperSectionHeader,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { errorText, failure, type Failure } from "../lib/failure";
import { TOOL_LIMITS, type ServerSpec, type ServerStatus } from "../toolsContract";
import { createTools, type Tools as ToolsClient } from "./api";
import { blankForm, formFromSpec, newRow, secretNameOf, specFromForm, typedSecrets, type Form, type Row } from "./form";

export default function Tools(props: { agent: Agent }) {
    const tools = createTools();
    // the page before this one stays up until the first read is in
    holdPage(tools.first);
    const name = () => props.agent.state.settings?.name ?? "The agent";

    return (
        <Switch>
            <Match when={tools.load() === "failed"}>
                <PaperEmptyState icon="error" title="Tools can't be read" description={tools.loadError() ?? undefined}>
                    <PaperButton onClick={() => void tools.refresh()}>Try again</PaperButton>
                </PaperEmptyState>
            </Match>
            <Match when={tools.view()}>
                {(view) => (
                    <PaperFlex gap="full">
                        <Show when={view().configError}>
                            <PaperQuote variant="danger" icon="error" title="Tools file unreadable" role="alert">
                                {name()}'s tools file can't be read ({view().configError}). Nothing was changed. Fix or delete tools.json in the panel's config, then try again.
                            </PaperQuote>
                            <PaperFlex direction="row">
                                <PaperButton onClick={() => void tools.refresh()}>
                                    <PaperIcon>refresh</PaperIcon> Try again
                                </PaperButton>
                            </PaperFlex>
                        </Show>
                        <ActionsAccess tools={tools} on={view().config.actions} locked={view().configError !== null} name={name()} />
                        <PaperSeparator />
                        <Servers tools={tools} agent={props.agent} />
                    </PaperFlex>
                )}
            </Match>
            <Match when={true}>
                <PaperLoader loaderStatus="indeterminate" label="Reading the tools" />
            </Match>
        </Switch>
    );
}

function ActionsAccess(props: { tools: ToolsClient; on: boolean; locked: boolean; name: string }) {
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const change = async (on: boolean) => {
        setBusy(true);
        setError(null);
        try {
            await props.tools.setActions(on);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <PaperFlex gap="full" role="region" aria-label="Paperboard actions">
            <PaperSectionHeader icon="widgets" title="Paperboard actions" role="heading" aria-level={2} />
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Let it use your other panels" description={`${props.name} can look up what your other panels can do (start a game server, post a message) and run it.`}>
                    <PaperToggle aria-label="Let it use your other panels" checked={props.on} disabled={busy() || props.locked} onChange={(v) => void change(v)} />
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="error" title="Panel access not changed" role="alert">
                    {error()}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}

const PHASE_TEXT: Record<ServerStatus["phase"], string> = { running: "Running", starting: "Starting…", stopped: "Stopped", failed: "Failed" };
const PHASE_VARIANT: Record<ServerStatus["phase"], "success" | "warning" | "danger" | "monochrome"> = { running: "success", starting: "warning", stopped: "monochrome", failed: "danger" };

function Servers(props: { tools: ToolsClient; agent: Agent }) {
    const view = () => props.tools.view()!;
    const locked = () => view().configError !== null;
    const name = () => props.agent.state.settings?.name ?? "The agent";
    const [form, setForm] = createSignal<Form | null>(null);
    // the editor stays mounted with the last form while it closes, so it animates out instead of vanishing
    const lastForm = createMemo<Form>((prev) => form() ?? prev, blankForm());
    const [removing, setRemoving] = createSignal<ServerSpec | null>(null);
    // a refused removal is told in the confirmation, which stays open over the page
    const [removeError, setRemoveError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal<string | null>(null);
    const [error, setError] = createSignal<Failure | null>(null);

    const act = async (key: string, title: string, fn: () => Promise<unknown>) => {
        setBusy(key);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError(failure(title, e));
        } finally {
            setBusy(null);
        }
    };
    const remove = async (s: ServerSpec) => {
        setBusy(`remove:${s.name}`);
        setRemoveError(null);
        try {
            await props.tools.remove(s.name);
            setRemoving(null);
        } catch (e) {
            setRemoveError(errorText(e));
        } finally {
            setBusy(null);
        }
    };
    const statusOf = (s: ServerSpec): ServerStatus => view().status.find((x) => x.name === s.name) ?? { name: s.name, phase: "stopped", error: null, tools: 0 };
    const where = (s: ServerSpec) => (s.transport === "http" ? "This computer, over the web" : "This computer");
    const addButton = () => (
        <PaperButton variant="primary" disabled={busy() !== null || locked() || view().config.servers.length >= TOOL_LIMITS.servers} onClick={() => setForm(blankForm())}>
            <PaperIcon>add</PaperIcon> Add a server
        </PaperButton>
    );

    return (
        <PaperFlex gap="full" role="region" aria-label="Tool servers">
            <PaperSectionHeader icon="dns" title="Tool servers" role="heading" aria-level={2} />
            <PaperText preset="hint" inset>
                MCP servers give {name()} more tools. They start when it next needs them. A server on this computer runs with your access; one inside {name()}'s computer stays in it.
            </PaperText>
            <For
                each={view().config.servers}
                fallback={
                    <PaperEmptyState icon="dns" title="No tool servers yet">
                        {addButton()}
                    </PaperEmptyState>
                }
            >
                {(server) => {
                    const status = () => statusOf(server);
                    const restart = () => act(`restart:${server.name}`, status().phase === "running" ? "Server not restarted" : "Server not started", () => props.tools.restart(server.name));
                    return (
                        <PaperCard surface="transparent" padding="inset" gap="half" role="group" aria-label={server.name}>
                            <PaperFlex direction="row" align="center" wrap gap="half">
                                <PaperFlex flex minWidth={0}>
                                    <PaperText preset="label" breakWord>
                                        {server.name}
                                    </PaperText>
                                </PaperFlex>
                                <PaperBadge variant={server.enabled ? PHASE_VARIANT[status().phase] : "monochrome"}>
                                    {server.enabled ? PHASE_TEXT[status().phase] : "Off"}
                                    {server.enabled && status().phase === "running" ? ` · ${status().tools} tools` : ""}
                                </PaperBadge>
                            </PaperFlex>
                            <PaperText preset="hint">
                                {where(server)} ·{" "}
                                {server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url}
                            </PaperText>
                            <Show when={server.enabled && status().error}>
                                <Show
                                    when={status().phase === "failed"}
                                    fallback={
                                        <PaperText preset="hint" role="status">
                                            {status().error}
                                        </PaperText>
                                    }
                                >
                                    <PaperQuote variant="danger" icon="error" title="Server failed" role="alert">
                                        {status().error}
                                    </PaperQuote>
                                </Show>
                            </Show>
                            <PaperFlex direction="row" wrap gap="half">
                                <Show when={server.enabled && status().phase !== "running" && status().phase !== "starting"}>
                                    <PaperButton disabled={busy() !== null || locked()} onClick={() => void restart()}>
                                        <PaperIcon>{status().phase === "failed" ? "refresh" : "play_arrow"}</PaperIcon> {status().phase === "failed" ? "Try again" : "Start now"}
                                    </PaperButton>
                                </Show>
                                <Show when={server.enabled && status().phase === "running"}>
                                    <PaperButton disabled={busy() !== null || locked()} onClick={() => void restart()}>
                                        <PaperIcon>refresh</PaperIcon> Restart
                                    </PaperButton>
                                </Show>
                                <PaperButton disabled={busy() !== null || locked()} onClick={() => setForm(formFromSpec(server))}>
                                    <PaperIcon>edit</PaperIcon> Edit
                                </PaperButton>
                                <PaperButton
                                    disabled={busy() !== null || locked()}
                                    onClick={() =>
                                        void act(`toggle:${server.name}`, server.enabled ? "Server not switched off" : "Server not switched on", () =>
                                            props.tools.save({ ...server, enabled: !server.enabled }),
                                        )
                                    }
                                >
                                    <PaperIcon>{server.enabled ? "pause" : "play_arrow"}</PaperIcon> {server.enabled ? "Switch off" : "Switch on"}
                                </PaperButton>
                                <PaperButton
                                    variant="danger"
                                    disabled={busy() !== null || locked()}
                                    onClick={() => {
                                        setRemoveError(null);
                                        setRemoving(server);
                                    }}
                                >
                                    <PaperIcon>delete</PaperIcon> Remove
                                </PaperButton>
                            </PaperFlex>
                        </PaperCard>
                    );
                }}
            </For>
            <Show when={view().config.servers.length > 0}>
                <PaperFlex direction="row">
                    {addButton()}
                </PaperFlex>
            </Show>
            <Show when={error()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>

            <Editor tools={props.tools} name={name()} open={form() !== null} initial={lastForm()} onClose={() => setForm(null)} />

            <PaperModal
                open={removing() !== null}
                onClose={() => busy() === null && setRemoving(null)}
                title={`Remove ${removing()?.name ?? "this server"}?`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy() !== null} onClick={() => setRemoving(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy() !== null}
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
                <PaperText preset="text">It stops, and the secrets saved for it are deleted. {name()} can't use its tools anymore.</PaperText>
                <Show when={removeError()}>
                    <PaperQuote variant="danger" icon="error" title="Server not removed" role="alert">
                        {removeError()}
                    </PaperQuote>
                </Show>
            </PaperModal>
        </PaperFlex>
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
