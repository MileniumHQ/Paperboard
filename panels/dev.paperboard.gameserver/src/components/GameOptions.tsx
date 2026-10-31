import { createSignal, onMount, For, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperInput,
    PaperPageHeader,
    PaperQuote,
    PaperRange,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import type { GameFeatures, GameOption, GameTab, OptionSection } from "../games";
import { serverBridge, serverStatus } from "../lib/server";
import { errorMessage } from "../lib/failure";
import { ACTION_IDS } from "../service/contract";
import { fitsNumber } from "../games/options";

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
            const valid = (raw: string) => raw.trim() !== "" && fitsNumber(field, Number(raw));
            return (
                <PaperInput
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
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
        case "slider": {
            // the value under the thumb while dragging; reported when the drag ends
            const [draft, setDraft] = createSignal<number | null>(null);
            return (
                <PaperFlex width="field-wide">
                    <PaperRange
                        aria-label={field.label}
                        min={field.min}
                        max={field.max}
                        marks={field.marks ? [...field.marks] : undefined}
                        value={draft() ?? Number(props.value ?? field.min)}
                        formatValue={(value) => `${value} ${field.unit}`}
                        disabled={props.disabled}
                        onInput={setDraft}
                        onChange={(value) => {
                            setDraft(null);
                            if (value !== props.value) props.onChange(value);
                        }}
                    />
                </PaperFlex>
            );
        }
        case "secret":
            return (
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperInput
                        type="password"
                        placeholder={secretPlaceholder(field.noun ?? "password", props.secretStored)}
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
                    maxLength={field.kind === "text" ? field.maxLength : undefined}
                    disabled={props.disabled}
                    onBlur={(e) => {
                        if (e.currentTarget.value !== String(props.value ?? "")) props.onChange(e.currentTarget.value);
                    }}
                />
            );
    }
}

/** Lists over this many options get a search field. */
const SEARCH_FROM = 12;

/**
 * A shared options tab: the game's options listed on this tab, stored by its
 * service. Options with a scope are edited where it names instead.
 */
export default function GameOptions(props: {
    tab: GameTab;
    fields: readonly GameOption[];
    whileRunning: GameFeatures["optionsWhileRunning"];
}) {
    const [values, setValues] = createSignal<Record<string, unknown> | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [saveError, setSaveError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [search, setSearch] = createSignal("");
    const listed = () => props.fields.filter((field) => !field.scope && (field.tab ?? "options") === props.tab.id);
    const fields = () => {
        const query = search().toLowerCase().trim();
        if (!query) return listed();
        return listed().filter((field) =>
            field.label.toLowerCase().includes(query) ||
            (field.description ?? "").toLowerCase().includes(query) ||
            field.id.toLowerCase().includes(query));
    };
    // unsectioned options first, then each section in the order it first appears
    const groups = () => {
        const list: { section?: OptionSection; fields: GameOption[] }[] = [{ fields: [] }];
        for (const field of fields()) {
            const group = list.find((g) => g.section?.title === field.section?.title);
            if (group) group.fields.push(field);
            else list.push({ section: field.section, fields: [field] });
        }
        return list.filter((g) => g.fields.length > 0);
    };
    const online = () => serverStatus() !== "offline";
    const locked = () => online() && props.whileRunning === "locked";
    // what a running server takes at once, named in the notice
    const live = () => listed().filter((field) => !field.restartRequired).map((field) => field.label);
    const liveNotice = () => {
        const names = live();
        if (names.length === 0) return "Changes apply the next time the server starts.";
        const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
        return `${list} ${names.length === 1 ? "applies" : "apply"} now. Other changes apply the next time the server starts.`;
    };

    const load = async () => {
        setLoadError("");
        try {
            setValues(await serverBridge.call<Record<string, unknown>>(ACTION_IDS.readGameOptions));
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
            setValues(await serverBridge.call<Record<string, unknown>>(ACTION_IDS.writeGameOptions, { patch: { [id]: next } }));
        } catch (err) {
            setSaveError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon={props.tab.icon} title={props.tab.label} />
            <Show when={listed().length > SEARCH_FROM}>
                <PaperCard padding="full">
                    <PaperInput
                        fullWidth
                        icon="search"
                        placeholder={`Search ${props.tab.label.toLowerCase()}...`}
                        value={search()}
                        onInput={(e) => setSearch(e.currentTarget.value)}
                    />
                </PaperCard>
            </Show>
            <Show
                when={online()}
                fallback={
                    <PaperQuote variant="warning" icon="info" title="When changes apply">
                        Changes apply the next time the server starts.
                    </PaperQuote>
                }
            >
                <Show
                    when={locked()}
                    fallback={
                        <PaperQuote variant="warning" icon="info" title="When changes apply">
                            {liveNotice()}
                        </PaperQuote>
                    }
                >
                    <PaperQuote variant="warning" icon="warning" title="Server running">
                        Stop the server to change its options.
                    </PaperQuote>
                </Show>
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
                <PaperQuote variant="danger" icon="warning" title="Options not saved" onDismiss={() => setSaveError("")}>
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
                <Show when={groups().length > 0} fallback={<PaperEmptyState icon="search" title="No settings match your search." />}>
                    <PaperFlex direction="column" gap="full" fullWidth>
                        <For each={groups()}>
                            {(group) => (
                                <PaperFlex direction="column" gap="half" fullWidth>
                                    <Show when={group.section}>
                                        {(section) => (
                                            <PaperFlex direction="column" gap="onefourth">
                                                <PaperText size={2} weight={700} color="text-subtle">{section().title}</PaperText>
                                                <Show when={section().description}>
                                                    <PaperText size={2} color="text-subtle">{section().description}</PaperText>
                                                </Show>
                                            </PaperFlex>
                                        )}
                                    </Show>
                                    <PaperSettingList autoHeight>
                                        <For each={group.fields}>
                                            {(field) => (
                                                <PaperSettingItem title={field.label} description={field.description}>
                                                    <GameOptionControl
                                                        field={field}
                                                        value={value(field)}
                                                        secretStored={Boolean(values()?.[field.id])}
                                                        disabled={locked() || saving()}
                                                        onChange={(next) => void save(field.id, next)}
                                                    />
                                                </PaperSettingItem>
                                            )}
                                        </For>
                                    </PaperSettingList>
                                </PaperFlex>
                            )}
                        </For>
                    </PaperFlex>
                </Show>
            </Show>
        </>
    );
}

function secretPlaceholder(noun: string, stored: boolean | undefined): string {
    return stored ? `${noun[0]!.toUpperCase()}${noun.slice(1)} set` : `No ${noun}`;
}
