// What the agent does on a schedule. It sets routines up when asked in the
// chat; here the user sees them, when each runs next, how the last run went,
// and can stop any of them. The list follows the service's routines revision.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperCard, PaperEmptyState, PaperFlex, PaperIcon, PaperLoader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { Routine } from "../contract";
import { describeSchedule, localStamp } from "../routineText";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";

export default function Routines(props: { agent: Agent }) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";
    const [list, setList] = createSignal<Routine[] | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [failed, setFailed] = createSignal<string | null>(null);

    let gone = false;
    onCleanup(() => (gone = true));
    // latest read wins: an older answer never replaces a newer one
    let reads = 0;
    const load = async () => {
        const mine = ++reads;
        try {
            const next = await agent.routines();
            if (!gone && mine === reads) {
                setList(next);
                setError(null);
            }
        } catch (e) {
            if (!gone && mine === reads) setError(errorText(e));
        }
    };
    createEffect(on(() => agent.state.routines.revision, () => void load()));

    const stop = async (r: Routine) => {
        setFailed(null);
        try {
            await agent.deleteRoutine(r.id);
        } catch (e) {
            setFailed(errorText(e));
        }
    };

    return (
        <Switch>
            <Match when={error() ?? agent.state.routines.error}>
                {(why) => (
                    <PaperEmptyState icon="error" title="Routines can't be read" description={why()}>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperEmptyState>
                )}
            </Match>
            <Match when={list() === null}>
                <PaperLoader loaderStatus="indeterminate" label="Reading routines" />
            </Match>
            <Match when={list()!.length === 0}>
                <PaperEmptyState
                    icon="event_repeat"
                    title="No routines yet"
                    description={`Ask ${name()} to do something later or regularly, like “text me a flag fact every weekday at 9”.`}
                />
            </Match>
            <Match when={true}>
                <PaperFlex gap="half">
                    <Show when={failed()}>
                        <PaperQuote variant="danger" icon="error" title="Routine not stopped" role="alert">
                            {failed()}
                        </PaperQuote>
                    </Show>
                    <For each={list()!}>
                        {(r) => (
                            <PaperCard borderless paddingX="full" paddingY="half">
                                <PaperFlex direction="row" align="center" gap="full">
                                    <PaperFlex flex minWidth={0} gap="onefourth">
                                        <PaperText preset="label">{r.what}</PaperText>
                                        <PaperText preset="hint">
                                            {describeSchedule(r.schedule)}
                                            {r.next ? ` · next ${localStamp(r.next)}` : ""}
                                            {r.lastRun ? ` · last ran ${localStamp(r.lastRun)}` : ""}
                                        </PaperText>
                                        <Show when={r.lastError}>
                                            <PaperQuote variant="danger" icon="error" title="Last run missed">
                                                {r.lastError}
                                            </PaperQuote>
                                        </Show>
                                    </PaperFlex>
                                    <PaperButton icon size="small" variant="danger" aria-label={`Stop: ${r.what}`} title="Stop this routine" onClick={() => void stop(r)}>
                                        <PaperIcon>delete</PaperIcon>
                                    </PaperButton>
                                </PaperFlex>
                            </PaperCard>
                        )}
                    </For>
                </PaperFlex>
            </Match>
        </Switch>
    );
}
