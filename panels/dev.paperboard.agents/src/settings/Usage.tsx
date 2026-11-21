// How much of a brain's plan is left: a tiny button on its row in the settings
// that opens a popover with a bar for each of its limits (the 5-hour session,
// the week, a model's own week), read fresh from the harness every time it
// opens. Only for brains with a plan to read (USAGE_HARNESSES), signed in.

import { For, Show, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperFlex, PaperLoader, PaperPopover, PaperProgress, PaperText, showError, type PaperRole } from "@mileniumhq/paperui";
import { createRead } from "@mileniumhq/paperui/headless";
import { USAGE_HARNESSES, type Harness, type UsageWindow } from "../contract";
import type { Agent } from "../lib/agent";
import { harnessName } from "../lib/brains";

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

export default function Usage(props: { agent: Agent; harness: Harness }) {
    const [open, setOpen] = createSignal(false);
    let button: HTMLButtonElement | undefined;

    const name = () => harnessName(props.harness);
    /** a plan to read, signed in */
    const shown = () => USAGE_HARNESSES.includes(props.harness) && props.agent.state.brains[props.harness].phase === "ready" && props.agent.state.brains[props.harness].signedIn;
    // read each time it opens; closed, nothing is read and the last answer stays for the next opening
    const usage = createRead((h: Harness) => props.agent.calls.usage({ harness: h }), { source: () => open() && shown() && props.harness });
    createEffect(
        on(usage.error, (error) => {
            if (!error) return;
            showError(`Couldn't read ${name()}'s usage`, error);
            setOpen(false);
        }),
    );
    // signed out, or another account signed in: the last numbers aren't this account's
    createEffect(on(shown, (s) => {
        usage.set(undefined);
        if (!s) setOpen(false);
    }, { defer: true }));

    const title = () => {
        const plan = usage.value()?.plan;
        return plan ? `${name()} ${plan}` : `${name()} usage`;
    };

    return (
        <Show when={shown()}>
            <PaperButton ref={button} icon size="tiny" variant="text" title="Usage" aria-expanded={open()} aria-label={`${name()} usage`} onClick={() => setOpen((o) => !o)}>
                data_usage
            </PaperButton>
            <PaperPopover open={open()} anchor={button} onClose={() => setOpen(false)} title={title()} header>
                <Show
                    when={usage.value()}
                    fallback={
                        <PaperFlex center padding="full">
                            <PaperLoader loaderStatus="indeterminate" size="small" label="Checking usage" />
                        </PaperFlex>
                    }
                >
                    {(u) => (
                        <Show when={u().windows.length} fallback={<PaperText preset="hint">This account is billed by use, with no plan limits.</PaperText>}>
                            <PaperFlex direction="column" gap="full">
                                <For each={u().windows}>{(w) => <Limit window={w} />}</For>
                            </PaperFlex>
                        </Show>
                    )}
                </Show>
            </PaperPopover>
        </Show>
    );
}
