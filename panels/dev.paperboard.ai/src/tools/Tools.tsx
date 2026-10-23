// The agent's tools: the MCP servers it can use (on this computer, or inside
// its own) and whether it may run other Paperboard panels' actions. Every
// change goes to the service, which validates it; a refused change says why.
// Secret values are typed into password fields and go straight to the
// daemon's vault; this page only ever sees their names.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import type { Agent } from "../lib/agent";
import { TOOL_LIMITS, type ServerSpec, type ServerStatus } from "../toolsContract";
import { createTools, type Tools as ToolsClient } from "./api";
import { blankForm, formFromSpec, newRow, secretNameOf, specFromForm, typedSecrets, type Form, type Row } from "./form";
import styles from "./Tools.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Tools(props: { agent: Agent }) {
    const tools = createTools();
    const name = () => props.agent.state.settings?.name ?? "The agent";

    return (
        <div class={styles.tools}>
            <Switch>
                <Match when={tools.load() === "failed"}>
                    <PaperText size={2} color="danger" role="alert">
                        The tools couldn't be read: {tools.loadError()}
                    </PaperText>
                    <div>
                        <PaperButton onClick={() => void tools.refresh()}>
                            <PaperIcon>refresh</PaperIcon> Try again
                        </PaperButton>
                    </div>
                </Match>
                <Match when={tools.view()}>
                    {(view) => (
                        <>
                            <Show when={view().configError}>
                                <PaperText size={2} color="danger" role="alert">
                                    {name()}'s tools file can't be read ({view().configError}). Nothing was changed. Fix or delete tools.json in the panel's config, then try again.
                                </PaperText>
                                <div>
                                    <PaperButton onClick={() => void tools.refresh()}>
                                        <PaperIcon>refresh</PaperIcon> Try again
                                    </PaperButton>
                                </div>
                            </Show>
                            <ActionsAccess tools={tools} on={view().config.actions} locked={view().configError !== null} name={name()} />
                            <PaperSeparator />
                            <Servers tools={tools} agent={props.agent} />
                        </>
                    )}
                </Match>
                <Match when={true}>
                    <PaperText size={2} color="text-muted" role="status">
                        Loading…
                    </PaperText>
                </Match>
            </Switch>
        </div>
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
            setError(message(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section class={styles.group} aria-label="Paperboard actions">
            <PaperText as="h2" preset="subtitle" class={styles.title}>
                Paperboard actions
            </PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Let it use your other panels" description={`${props.name} can look up what your other panels can do (start a game server, post a message) and run it.`}>
                    <PaperToggle aria-label="Let it use your other panels" checked={props.on} disabled={busy() || props.locked} onChange={(v) => void change(v)} />
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
        </section>
    );
}

const PHASE_TEXT: Record<ServerStatus["phase"], string> = { running: "Running", starting: "Starting…", stopped: "Stopped", failed: "Failed" };
const PHASE_VARIANT: Record<ServerStatus["phase"], "success" | "warning" | "danger" | "monochrome"> = { running: "success", starting: "warning", stopped: "monochrome", failed: "danger" };

function Servers(props: { tools: ToolsClient; agent: Agent }) {
    const view = () => props.tools.view()!;
    const locked = () => view().configError !== null;
    const name = () => props.agent.state.settings?.name ?? "The agent";
    const [form, setForm] = createSignal<Form | null>(null);
    const [removing, setRemoving] = createSignal<ServerSpec | null>(null);
    const [busy, setBusy] = createSignal<string | null>(null);
    const [error, setError] = createSignal<string | null>(null);

    const act = async (key: string, fn: () => Promise<unknown>) => {
        setBusy(key);
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(message(e));
            return false;
        } finally {
            setBusy(null);
        }
    };
    const statusOf = (s: ServerSpec): ServerStatus => view().status.find((x) => x.name === s.name) ?? { name: s.name, phase: "stopped", error: null, tools: 0 };
    const where = (s: ServerSpec) => (s.transport === "http" ? "This computer, over the web" : s.where === "computer" ? `${name()}'s computer` : "This computer");

    return (
        <section class={styles.group} aria-label="Tool servers">
            <PaperText as="h2" preset="subtitle" class={styles.title}>
                Tool servers
            </PaperText>
            <PaperText size={2} color="text-muted" class={styles.hint}>
                MCP servers give {name()} more tools. They start when it next needs them. A server on this computer runs with your access; one inside {name()}'s computer stays in it.
            </PaperText>
            <For each={view().config.servers} fallback={<PaperText size={2} color="text-muted">No tool servers yet.</PaperText>}>
                {(server) => {
                    const status = () => statusOf(server);
                    return (
                        <div class={styles.server} role="group" aria-label={server.name}>
                            <div class={styles.head}>
                                <PaperText weight={600} class={styles.name}>
                                    {server.name}
                                </PaperText>
                                <PaperBadge variant={server.enabled ? PHASE_VARIANT[status().phase] : "monochrome"}>
                                    {server.enabled ? PHASE_TEXT[status().phase] : "Off"}
                                    {server.enabled && status().phase === "running" ? ` · ${status().tools} tools` : ""}
                                </PaperBadge>
                            </div>
                            <PaperText size={2} color="text-muted">
                                {where(server)} ·{" "}
                                {server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url}
                            </PaperText>
                            <Show when={server.enabled && status().error}>
                                <PaperText size={2} color={status().phase === "failed" ? "danger" : "text-muted"} role={status().phase === "failed" ? "alert" : "status"}>
                                    {status().error}
                                </PaperText>
                            </Show>
                            <div class={styles.buttons}>
                                <Show when={server.enabled && status().phase !== "running" && status().phase !== "starting"}>
                                    <PaperButton disabled={busy() !== null || locked()} onClick={() => void act(`restart:${server.name}`, () => props.tools.restart(server.name))}>
                                        <PaperIcon>{status().phase === "failed" ? "refresh" : "play_arrow"}</PaperIcon> {status().phase === "failed" ? "Try again" : "Start now"}
                                    </PaperButton>
                                </Show>
                                <Show when={server.enabled && status().phase === "running"}>
                                    <PaperButton disabled={busy() !== null || locked()} onClick={() => void act(`restart:${server.name}`, () => props.tools.restart(server.name))}>
                                        <PaperIcon>refresh</PaperIcon> Restart
                                    </PaperButton>
                                </Show>
                                <PaperButton disabled={busy() !== null || locked()} onClick={() => setForm(formFromSpec(server))}>
                                    <PaperIcon>edit</PaperIcon> Edit
                                </PaperButton>
                                <PaperButton disabled={busy() !== null || locked()} onClick={() => void act(`toggle:${server.name}`, () => props.tools.save({ ...server, enabled: !server.enabled }))}>
                                    <PaperIcon>{server.enabled ? "pause" : "play_arrow"}</PaperIcon> {server.enabled ? "Switch off" : "Switch on"}
                                </PaperButton>
                                <PaperButton variant="danger" disabled={busy() !== null || locked()} onClick={() => setRemoving(server)}>
                                    <PaperIcon>delete</PaperIcon> Remove
                                </PaperButton>
                            </div>
                        </div>
                    );
                }}
            </For>
            <div>
                <PaperButton variant="primary" disabled={busy() !== null || locked() || view().config.servers.length >= TOOL_LIMITS.servers} onClick={() => setForm(blankForm())}>
                    <PaperIcon>add</PaperIcon> Add a server
                </PaperButton>
            </div>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>

            <Show when={form()}>{(f) => <Editor tools={props.tools} name={name()} initial={f()} onClose={() => setForm(null)} />}</Show>

            <PaperModal
                open={removing() !== null}
                onClose={() => busy() === null && setRemoving(null)}
                title={`Remove ${removing()?.name ?? "this server"}?`}
                size="small"
                footer={
                    <>
                        <PaperButton disabled={busy() !== null} onClick={() => setRemoving(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy() !== null}
                            onClick={async () => {
                                const s = removing();
                                if (s && (await act(`remove:${s.name}`, () => props.tools.remove(s.name)))) setRemoving(null);
                            }}
                        >
                            Remove
                        </PaperButton>
                    </>
                }
            >
                <PaperText>It stops, and the secrets saved for it are deleted. {name()} can't use its tools anymore.</PaperText>
            </PaperModal>
        </section>
    );
}

function Editor(props: { tools: ToolsClient; name: string; initial: Form; onClose: () => void }) {
    const [f, setF] = createSignal<Form>(props.initial);
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
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
            setError(message(e));
            setBusy(false);
            return;
        }
        // the server is saved; its secrets go to the vault now
        try {
            for (const s of typedSecrets(f())) await props.tools.setSecret(f().name.trim(), s.name, s.value);
        } catch (e) {
            setError(`The server was saved, but a secret wasn't: ${message(e)} Edit it to add the secret again.`);
            setBusy(false);
            return;
        }
        props.onClose();
    };

    return (
        <PaperModal
            open
            onClose={() => !busy() && props.onClose()}
            title={f().editing ? `Edit ${f().name}` : "Add a tool server"}
            size="medium"
            footer={
                <>
                    <PaperButton disabled={busy()} onClick={props.onClose}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="primary" disabled={busy()} onClick={() => void save()}>
                        Save
                    </PaperButton>
                </>
            }
        >
            <form
                class={styles.form}
                onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                }}
            >
                <PaperInput
                    name="name"
                    label="Name"
                    placeholder="github"
                    value={f().name}
                    maxLength={TOOL_LIMITS.name}
                    disabled={f().editing}
                    onInput={(e) => set("name", e.currentTarget.value)}
                />
                <div class={styles.fields}>
                    <PaperText size={2} weight={600}>
                        Type
                    </PaperText>
                    <PaperSelectMenu
                        name="transport"
                        aria-label="Type"
                        value={f().transport}
                        onValueChange={(v) => setF((cur) => ({ ...cur, transport: v as Form["transport"], where: v === "http" ? "host" : cur.where, rows: [] }))}
                    >
                        <PaperSelectMenuItem value="stdio" icon="terminal" description="A program the server runs for you">
                            Program
                        </PaperSelectMenuItem>
                        <PaperSelectMenuItem value="http" icon="language" description="A server you reach over the web (streamable HTTP)">
                            Web address
                        </PaperSelectMenuItem>
                    </PaperSelectMenu>
                </div>
                <Show when={!http()}>
                    <div class={styles.fields}>
                        <PaperText size={2} weight={600}>
                            Runs on
                        </PaperText>
                        <PaperSelectMenu name="where" aria-label="Runs on" value={f().where} onValueChange={(v) => set("where", v as Form["where"])}>
                            <PaperSelectMenuItem value="host" icon="computer" description="With your access to your files and network">
                                This computer
                            </PaperSelectMenuItem>
                            <PaperSelectMenuItem value="computer" icon="memory" description="Inside its own computer, where it can't reach yours">
                                {props.name}'s computer
                            </PaperSelectMenuItem>
                        </PaperSelectMenu>
                    </div>
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

                <div class={styles.fields}>
                    <PaperText size={2} weight={600}>
                        {valuesLabel()}
                    </PaperText>
                    <Show when={http()}>
                        <PaperText size={1} color="text-muted" class={styles.hint}>
                            A secret header holds the whole value, like “Bearer abc123”.
                        </PaperText>
                    </Show>
                    <For each={f().rows}>
                        {(row) => (
                            <div class={styles.row} role="group" aria-label={row.name || valuesLabel()}>
                                <PaperInput label="Name" value={row.name} maxLength={TOOL_LIMITS.envName} onInput={(e) => setRow(row.key, { name: e.currentTarget.value })} />
                                <PaperSelectMenu name={`kind-${row.key}`} aria-label="Kind" value={row.kind} onValueChange={(v) => setRow(row.key, { kind: v as Row["kind"], value: "", typed: "" })}>
                                    <PaperSelectMenuItem value="value">Value</PaperSelectMenuItem>
                                    <PaperSelectMenuItem value="secret">Secret</PaperSelectMenuItem>
                                </PaperSelectMenu>
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
                                <PaperButton aria-label={`Remove ${row.name || "this row"}`} onClick={() => set("rows", f().rows.filter((r) => r.key !== row.key))}>
                                    <PaperIcon>close</PaperIcon>
                                </PaperButton>
                            </div>
                        )}
                    </For>
                    <div>
                        <PaperButton disabled={f().rows.length >= (http() ? TOOL_LIMITS.headers : TOOL_LIMITS.env)} onClick={() => set("rows", [...f().rows, newRow()])}>
                            <PaperIcon>add</PaperIcon> Add {http() ? "a header" : "a variable"}
                        </PaperButton>
                    </div>
                </div>
                <Show when={error()}>
                    <PaperText size={2} color="danger" role="alert">
                        {error()}
                    </PaperText>
                </Show>
            </form>
        </PaperModal>
    );
}
