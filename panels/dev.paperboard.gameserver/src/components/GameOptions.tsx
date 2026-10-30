import { createSignal, onMount, For, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import type { GameOption } from "../games";
import { serverBridge, serverStatus } from "../lib/server";
import { errorMessage } from "../lib/failure";

/**
 * One option's control. Toggles and menus report a change at once; text,
 * number and password fields report it when they lose focus, so a half-typed
 * value is never saved.
 */
export function GameOptionControl(props: {
    field: GameOption;
    value: unknown;
    /** a stored secret: the empty field then reads as "leave unchanged" */
    secretStored?: boolean;
    disabled?: boolean;
    onChange: (value: unknown) => void;
}) {
    const field = props.field;
    switch (field.kind) {
        case "boolean":
            return <PaperToggle checked={Boolean(props.value)} disabled={props.disabled} onChange={(checked) => props.onChange(checked)} />;
        case "select":
            return (
                <PaperSelectMenu name={field.id} value={String(props.value ?? "")} disabled={props.disabled} onValueChange={(value) => props.onChange(String(value))}>
                    <For each={field.choices}>{(choice) => <PaperSelectMenuItem value={choice.value}>{choice.label}</PaperSelectMenuItem>}</For>
                </PaperSelectMenu>
            );
        case "number": {
            const [draft, setDraft] = createSignal<string | null>(null);
            const shown = () => draft() ?? String(props.value ?? "");
            const valid = (raw: string) => raw.trim() !== "" && Number.isInteger(Number(raw)) && Number(raw) >= field.min && Number(raw) <= field.max;
            return (
                <PaperInput
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={shown()}
                    invalid={!valid(shown())}
                    disabled={props.disabled}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onBlur={() => {
                        const raw = draft();
                        setDraft(null);
                        if (raw !== null && valid(raw) && Number(raw) !== props.value) props.onChange(Number(raw));
                    }}
                />
            );
        }
        case "secret":
            return (
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperInput
                        type="password"
                        placeholder={props.secretStored ? "Password set" : "No password"}
                        disabled={props.disabled}
                        onBlur={(e) => {
                            const value = e.currentTarget.value;
                            if (!value) return;
                            e.currentTarget.value = "";
                            props.onChange(value);
                        }}
                    />
                    <Show when={props.secretStored}>
                        <PaperButton size="tiny" disabled={props.disabled} onClick={() => props.onChange("")}>Remove</PaperButton>
                    </Show>
                </PaperFlex>
            );
        default:
            return (
                <PaperInput
                    value={String(props.value ?? "")}
                    disabled={props.disabled}
                    onBlur={(e) => {
                        if (e.currentTarget.value !== String(props.value ?? "")) props.onChange(e.currentTarget.value);
                    }}
                />
            );
    }
}

/** A game's own options, stored by its service. World-generation options live in New World instead. */
export default function GameOptions(props: { fields: readonly GameOption[] }) {
    const [values, setValues] = createSignal<Record<string, unknown> | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const fields = () => props.fields.filter((field) => field.scope !== "world");
    const online = () => serverStatus() !== "offline";

    const load = async () => {
        setLoadError("");
        try {
            setValues(await serverBridge.call<Record<string, unknown>>("read-game-options"));
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    onMount(() => void load());

    const value = (field: GameOption) => values()?.[field.id] ?? (field.kind === "secret" ? "" : field.default);

    const save = async (id: string, next: unknown) => {
        setSaving(true);
        setSaveError("");
        try {
            setValues(await serverBridge.call<Record<string, unknown>>("write-game-options", { patch: { [id]: next } }));
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="tune" title="Options" />
            <Show
                when={online()}
                fallback={
                    <PaperQuote variant="warning" icon="info" title="When changes apply">
                        Changes apply the next time the server starts.
                    </PaperQuote>
                }
            >
                <PaperQuote variant="warning" icon="warning" title="Server running">
                    Stop the server to change its options.
                </PaperQuote>
            </Show>
            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't read the options">
                    <PaperFlex direction="column" gap="half">
                        <PaperText>{loadError()}</PaperText>
                        <PaperButton size="tiny" onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={saveError()}>
                <PaperQuote variant="danger" icon="warning" title="Options not saved">
                    {saveError()}
                </PaperQuote>
            </Show>
            <Show
                when={values()}
                fallback={
                    <Show when={!loadError()}>
                        <PaperText size={2} color="text-subtle">Loading settings…</PaperText>
                    </Show>
                }
            >
                <PaperSettingList autoHeight>
                    <For each={fields()}>
                        {(field) => (
                            <PaperSettingItem title={field.label} description={field.description}>
                                <GameOptionControl
                                    field={field}
                                    value={value(field)}
                                    secretStored={Boolean(values()?.[field.id])}
                                    disabled={online() || saving()}
                                    onChange={(next) => void save(field.id, next)}
                                />
                            </PaperSettingItem>
                        )}
                    </For>
                </PaperSettingList>
            </Show>
        </>
    );
}
