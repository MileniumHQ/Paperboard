import { createSignal, onMount, For, Show } from "solid-js";
import { PaperSettingList, PaperSettingItem, PaperInput, PaperToggle, PaperSelectMenu, PaperSelectMenuItem, PaperButton, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { GameOption } from "../games";
import { serverBridge } from "../lib/server";
export default function GameOptions(props: { fields: readonly GameOption[] }) {
    const [values, setValues] = createSignal<Record<string, unknown>>({});
    const [patch, setPatch] = createSignal<Record<string, unknown>>({});
    const [error, setError] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [loaded, setLoaded] = createSignal(false);
    const [notice, setNotice] = createSignal("");
    const load = async () => { try { setValues(await serverBridge.call("read-game-options")); setLoaded(true); } catch (err) { setError(String(err)); } };
    onMount(() => void load());
    const value = (field: GameOption) => patch()[field.id] ?? values()[field.id] ?? (field.kind === "secret" ? "" : field.default);
    const change = (id: string, value: unknown) => setPatch(p => ({ ...p, [id]: value }));
    const save = async () => {
        setBusy(true); setError(""); setNotice("");
        try { await serverBridge.call("write-game-options", { patch: patch() }); setPatch({}); await load(); setNotice("Saved. Changes apply on the next start."); }
        catch (err) { setError(String(err)); } finally { setBusy(false); }
    };
    return <>
        <Show when={error()}><PaperQuote variant="danger" title="Options could not be saved">{error()}<PaperButton onClick={() => void load()}>Reload</PaperButton></PaperQuote></Show>
        <Show when={notice()}><PaperQuote variant="success">{notice()}</PaperQuote></Show>
        <PaperText>Stop the server before changing options. Creation settings apply to new worlds only.</PaperText>
        <PaperSettingList autoHeight><For each={props.fields}>{field => <PaperSettingItem title={field.label} description={field.description}>
            {field.kind === "boolean" ? <PaperToggle checked={Boolean(value(field))} disabled={busy() || !loaded()} onChange={v => change(field.id, v)} />
            : field.kind === "select" ? <PaperSelectMenu name={field.id} value={String(value(field) ?? "")} disabled={busy() || !loaded()} onValueChange={v => change(field.id, v)}><For each={field.choices}>{choice => <PaperSelectMenuItem value={choice.value}>{choice.label}</PaperSelectMenuItem>}</For></PaperSelectMenu>
            : <PaperInput type={field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text"} value={field.kind === "secret" ? String(patch()[field.id] ?? "") : String(value(field) ?? "")} placeholder={field.kind === "secret" ? values()[field.id] ? "Password stored; leave unchanged" : "No password" : undefined} disabled={busy() || !loaded()} onInput={e => change(field.id, field.kind === "number" ? Number(e.currentTarget.value) : e.currentTarget.value)} />}
        </PaperSettingItem>}</For></PaperSettingList>
        <PaperButton disabled={busy() || !loaded() || !Object.keys(patch()).length} onClick={() => void save()}>{busy() ? "Saving…" : "Save options"}</PaperButton>
    </>;
}
