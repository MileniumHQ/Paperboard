// How much of a brain's plan is left: a tiny button on its row in the settings
// that opens a popover with a bar for each of its limits (the 5-hour session,
// the week, a model's own week), read fresh from the harness every time it
// opens. A failure stands in the popover, with Try again.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperError, PaperFlex, PaperLoader, PaperPopover, PaperProgress, PaperText, type PaperRole } from "@mileniumhq/paperui";
import { createRead } from "@mileniumhq/paperui/headless";
import { BRAINS, type Harness, type UsageWindow } from "../contract";
import type { Agent } from "../lib/agent";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Resets in 3 hr 12 min" within a day, "Resets Mon 10:00 PM" within a week, "Resets Dec 21" after */
export function resetWords(at: string, now = Date.now()): string {
    const when = new Date(at);
    const ms = when.getTime() - now;
    if (ms <= MINUTE) return "Resets in a moment";
    if (ms < DAY) {
        const h = Math.floor(ms / HOUR);
        const m = Math.round((ms % HOUR) / MINUTE);
        return `Resets in ${h ? `${h} hr ` : ""}${m || !h ? `${m} min` : ""}`.trimEnd();
    }
    if (ms < 7 * DAY) return `Resets ${when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
    return `Resets ${when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** the bar turns as it runs low */
const roleFor = (left: number): PaperRole | undefined => (left <= 10 ? "danger" : left <= 25 ? "warning" : undefined);

function Limit(props: { window: UsageWindow }) {
    const left = () => Math.round(100 - props.window.used);
    return (
        <PaperFlex direction="column" gap="onefourth" data-usage={props.window.id}>
            <PaperFlex direction="row" justify="space-between" align="baseline" gap="half">
                <PaperText preset="label">{props.window.label}</PaperText>
                <PaperText preset="hint">{`${left()}% left`}</PaperText>
            </PaperFlex>
            <PaperProgress value={left()} variant={roleFor(left())} aria-label={`${props.window.label}: ${left()}% left`} />
            <Show when={props.window.resetsAt}>{(at) => <PaperText preset="hint">{resetWords(at())}</PaperText>}</Show>
        </PaperFlex>
    );
}

/** The button and its popover, for a brain with a plan to read (USAGE_HARNESSES) that is signed in: BrainButtons shows it on a ready row. */
export default function Usage(props: { agent: Agent; harness: Harness }) {
    const [open, setOpen] = createSignal(false);
    let button: HTMLButtonElement | undefined;

    const name = () => BRAINS[props.harness].name;
    // read each time it opens; closed, nothing is read and the last answer stays for the next opening
    const usage = createRead((h: Harness) => props.agent.calls.usage({ harness: h }), { source: () => open() && props.harness });

    const title = () => {
        const plan = usage.value()?.plan;
        return plan ? `${name()} ${plan}` : `${name()} usage`;
    };

    return (
        <>
            <PaperButton ref={button} icon size="tiny" variant="text" title="Usage" aria-expanded={open()} aria-label={`${name()} usage`} onClick={() => setOpen((o) => !o)}>
                data_usage
            </PaperButton>
            <PaperPopover open={open()} anchor={button} onClose={() => setOpen(false)} title={title()} header>
                <Switch>
                    {/* a failure stands while it's open, until a read gets an answer */}
                    <Match when={usage.error() && !usage.loading()}>
                        <PaperError title={`Couldn't read ${name()}'s usage`} error={usage.error()} action={{ label: "Try again", onClick: () => void usage.reload() }} />
                    </Match>
                    <Match when={usage.value()}>
                        {(u) => (
                            <Show when={u().windows.length} fallback={<PaperText preset="hint">This account is billed by use, with no plan limits.</PaperText>}>
                                <PaperFlex direction="column" gap="full">
                                    <For each={u().windows}>{(w) => <Limit window={w} />}</For>
                                </PaperFlex>
                            </Show>
                        )}
                    </Match>
                    <Match when={true}>
                        <PaperFlex center padding="full">
                            <PaperLoader loaderStatus="indeterminate" size="small" label="Checking usage" />
                        </PaperFlex>
                    </Match>
                </Switch>
            </PaperPopover>
        </>
    );
}
