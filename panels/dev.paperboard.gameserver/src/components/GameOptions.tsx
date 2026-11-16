import { createEffect, createMemo, createSignal, on, For, Show, untrack } from "solid-js";
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
    sameData,
    createRead,
} from "@mileniumhq/paperui";
import type { GameFeatures, GameOption, GameTab } from "../games";
import { useServer } from "../lib/server";
import { errorMessage } from "../lib/failure";
import { createSaves } from "../lib/saves";
import { fitsNumber, numberRule } from "../games/options";
import { describeWithProblem } from "./PropertyFieldControl";

/**
 * One option's control. Toggles and menus report a change at once; text,
 * number and password fields keep what is typed as a draft and report it
 * when they lose focus or Enter is pressed, so a half-typed value is never
 * saved. A number out of the option's range is not reported: `onProblem`
 * hears why, and the field keeps it until it is corrected.
 */
export function GameOptionControl(props: {
    field: GameOption;
    value: unknown;
    /** a stored secret: the empty field then reads as "leave unchanged" */
    secretStored?: boolean;
    disabled?: boolean;
    onChange: (value: unknown) => void;
    /** why the typed value can't be saved, or "" once it can */
    onProblem?: (problem: string) => void;
}) {
    // an option's kind is what it is; the rest follows the option as it is described again
    const field = <K extends GameOption["kind"]>(_kind: K) => props.field as Extract<GameOption, { kind: K }>;
    switch (untrack(() => props.field.kind)) {
        case "boolean":
            return <PaperToggle checked={Boolean(props.value)} disabled={props.disabled} onChange={(checked) => props.onChange(checked)} />;
        case "select":
            return (
                <PaperSelectMenu name={field("select").id} value={String(props.value ?? "")} disabled={props.disabled} onValueChange={(value) => props.onChange(String(value))}>
                    <For each={field("select").choices}>{(choice) => <PaperSelectMenuItem value={choice.value}>{choice.label}</PaperSelectMenuItem>}</For>
                </PaperSelectMenu>
            );
        case "number": {
            const [draft, setDraft] = createSignal<string | null>(null);
            const shown = () => draft() ?? String(props.value ?? "");
            const valid = (raw: string) => raw.trim() !== "" && fitsNumber(field("number"), Number(raw));
            createEffect(on(() => (valid(shown()) ? "" : `${numberRule(field("number"))}.`), (problem) => props.onProblem?.(problem)));
            return (
                // every number field is as wide as a menu, whatever its range
                <PaperFlex width="field">
                    <PaperInput
                        fullWidth
                        type="number"
                        min={field("number").min}
                        max={field("number").max}
                        step={field("number").step ?? 1}
                        value={shown()}
                        invalid={!valid(shown())}
                        disabled={props.disabled}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={commitOnEnter}
                        onBlur={() => {
                            const raw = draft();
                            // a value out of range stays, with its reason, until it is corrected
                            if (raw === null || !valid(raw)) return;
                            setDraft(null);
                            if (Number(raw) !== props.value) props.onChange(Number(raw));
                        }}
                    />
                </PaperFlex>
            );
        }
        case "slider": {
            // the value under the thumb while dragging; reported when the drag ends
            const [draft, setDraft] = createSignal<number | null>(null);
            return (
                <PaperFlex width="field-wide">
                    <PaperRange
                        aria-label={field("slider").label}
                        min={field("slider").min}
                        max={field("slider").max}
                        step={field("slider").step}
                        marks={field("slider").marks ? [...field("slider").marks!] : undefined}
                        value={draft() ?? Number(props.value ?? field("slider").min)}
                        formatValue={(value) => `${value} ${field("slider").unit}`}
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
        case "secret": {
            // what is typed; a stored secret is never shown, so the field empties once it is sent
            const [draft, setDraft] = createSignal("");
            return (
                <PaperFlex direction="row" gap="half" align="center">
                    <PaperInput
                        type="password"
                        placeholder={secretPlaceholder(field("secret").noun ?? "password", props.secretStored)}
                        disabled={props.disabled}
                        value={draft()}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={commitOnEnter}
                        onBlur={() => {
                            const typed = draft();
                            if (!typed) return;
                            setDraft("");
                            props.onChange(typed);
                        }}
                    />
                    <Show when={props.secretStored}>
                        <PaperButton size="tiny" disabled={props.disabled} onClick={() => props.onChange("")}>Remove</PaperButton>
                    </Show>
                </PaperFlex>
            );
        }
        default: {
            const [draft, setDraft] = createSignal<string | null>(null);
            return (
                <PaperFlex width="field-wide">
                    <PaperInput
                        fullWidth
                        value={draft() ?? String(props.value ?? "")}
                        maxLength={props.field.kind === "text" ? props.field.maxLength : undefined}
                        disabled={props.disabled}
                        onInput={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={commitOnEnter}
                        onBlur={() => {
                            const typed = draft();
                            setDraft(null);
                            if (typed !== null && typed !== String(props.value ?? "")) props.onChange(typed);
                        }}
                    />
                </PaperFlex>
            );
        }
    }
}

/**
 * An option's row: its title, its description and, while the typed value
 * can't be saved, why not.
 */
export function GameOptionItem(props: {
    field: GameOption;
    value: unknown;
    secretStored?: boolean;
    disabled?: boolean;
    onChange: (value: unknown) => void;
}) {
    const [problem, setProblem] = createSignal("");
    return (
        <PaperSettingItem title={props.field.label} description={describeWithProblem(props.field.description, problem())}>
            <GameOptionControl
                field={props.field}
                value={props.value}
                secretStored={props.secretStored}
                disabled={props.disabled}
                onChange={props.onChange}
                onProblem={setProblem}
            />
        </PaperSettingItem>
    );
}

/** Enter in a field commits it, as leaving it does. */
export const commitOnEnter = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") e.currentTarget.blur();
};

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
    const { calls, serverStatus } = useServer();
    const options = createRead(() => calls.readGameOptions(), { message: errorMessage });
    const values = options.value;
    // a read again shows the loader, not the last failure
    const loadError = () => (options.loading() ? "" : (options.error() ?? ""));
    const [saveError, setSaveError] = createSignal("");
    const [search, setSearch] = createSignal("");
    const listed = createMemo(() => props.fields.filter((field) => !field.scope && (field.tab ?? "options") === props.tab.id));
    // the game describes its options again as its state changes, in new
    // objects: an option is the row of its id, so its control stays the one
    // it is (its focus, its draft, its open menu) through every describe
    const byId = createMemo(() => new Map(listed().map((field) => [field.id, field])));
    const matching = createMemo(() => {
        const query = search().toLowerCase().trim();
        if (!query) return listed();
        return listed().filter((field) =>
            field.label.toLowerCase().includes(query) ||
            (field.description ?? "").toLowerCase().includes(query) ||
            field.id.toLowerCase().includes(query));
    });
    // unsectioned options first, then each section in the order it first
    // appears, each by its title and its options by their ids
    const groups = createMemo(
        () => {
            const list: { title: string; ids: string[] }[] = [{ title: "", ids: [] }];
            for (const field of matching()) {
                const title = field.section?.title ?? "";
                const group = list.find((g) => g.title === title);
                if (group) group.ids.push(field.id);
                else list.push({ title, ids: [field.id] });
            }
            return list.filter((g) => g.ids.length > 0);
        },
        undefined,
        { equals: sameData },
    );
    const titles = createMemo(() => groups().map((group) => group.title), undefined, { equals: sameData });
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

    const saves = createSaves({ failed: (err) => setSaveError(errorMessage(err)), changed: () => setSaveError("") });

    /** one option's row: its control saves through the tab's saves */
    const OptionRow = (row: { id: string }) => {
        const field = () => byId().get(row.id)!;
        const saved = saves.setting<unknown>(
            row.id,
            () => {
                const option = field();
                return values()?.[row.id] ?? (option.kind === "secret" ? "" : option.default);
            },
            async (next) => {
                options.set(await calls.writeGameOptions({ patch: { [row.id]: next } }));
            },
        );
        return (
            <GameOptionItem
                field={field()}
                value={saved.value()}
                secretStored={Boolean(saved.value())}
                disabled={locked()}
                onChange={saved.set}
            />
        );
    };

    return (
        <>
            <PaperPageHeader icon={props.tab.icon} title={props.tab.label} />
            <Show when={listed().length > SEARCH_FROM}>
                <PaperCard padding="full">
                    <PaperInput
                        fullWidth
                        icon="search"
                        placeholder="Setting"
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
                        <PaperButton size="tiny" onClick={() => void options.reload()}>Try again</PaperButton>
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
                <Show when={titles().length > 0} fallback={<PaperEmptyState icon="search" title="No settings match your search." />}>
                    <PaperFlex direction="column" gap="full" fullWidth>
                        <For each={titles()}>
                            {(title) => {
                                const ids = createMemo(() => groups().find((group) => group.title === title)?.ids ?? [], undefined, { equals: sameData });
                                const section = () => (title ? byId().get(ids()[0]!)?.section : undefined);
                                return (
                                    <PaperFlex direction="column" gap="half" fullWidth>
                                        <Show when={section()}>
                                            {(shown) => (
                                                <PaperFlex direction="column" gap="onefourth">
                                                    <PaperText size={2} weight={700} color="text-subtle">{shown().title}</PaperText>
                                                    <Show when={shown().description}>
                                                        <PaperText size={2} color="text-subtle">{shown().description}</PaperText>
                                                    </Show>
                                                </PaperFlex>
                                            )}
                                        </Show>
                                        <PaperSettingList autoHeight>
                                            <For each={ids()}>{(id) => <OptionRow id={id} />}</For>
                                        </PaperSettingList>
                                    </PaperFlex>
                                );
                            }}
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
