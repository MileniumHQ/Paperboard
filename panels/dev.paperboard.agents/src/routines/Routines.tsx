// What the agent does on a schedule. It sets routines up when asked in the
// chat; here the user sees them, when each runs next, how the last run went,
// and can stop any of them. The list follows the service's routines revision.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperQuote, createRead } from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import type { Routine } from "../contract";
import { describeSchedule, localStamp } from "../routineText";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export default function Routines(props: { agent: Agent }) {
    const name = () => props.agent.name();
    // follows the routines revision; a re-read changes only what differs, and every row stays the row it was
    const routines = createRead(() => props.agent.routines(), { source: () => props.agent.state.routines.revision });
    const list = () => routines.value() ?? null;
    const [failed, setFailed] = createSignal<string | null>(null);
    // the page before this one stays up until the first read is in
    holdPage(routines.ready());

    // a second press while the first is on its way is the same stop, not a refused one
    const stopping = new Set<string>();
    const stop = async (r: Routine) => {
        if (stopping.has(r.id)) return;
        stopping.add(r.id);
        setFailed(null);
        try {
            await props.agent.deleteRoutine(r.id);
        } catch (e) {
            setFailed(errorMessage(e));
        } finally {
            stopping.delete(r.id);
        }
    };

    return (
        <Switch>
            <Match when={routines.error() ?? props.agent.state.routines.error}>
                {(why) => (
                    <PaperEmptyState icon="error" title="Routines can't be read" description={why()}>
                        <PaperButton onClick={() => void routines.reload()}>Try again</PaperButton>
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
                    {/* like alarms: when it runs is the title, what it does wraps below it */}
                    <PaperList selectable={false} borderless fullWidth>
                        <For each={list()!}>
                            {(r) => (
                                <PaperListItem
                                    value={r.id}
                                    icon="event_repeat"
                                    description={`${r.what}${r.next ? ` · next ${localStamp(r.next)}` : ""}${r.lastRun ? ` · last ran ${localStamp(r.lastRun)}` : ""}`}
                                    actions={
                                        <PaperButton icon size="small" variant="text" aria-label={`Stop: ${r.what}`} title="Stop this routine" onClick={() => void stop(r)}>
                                            <PaperIcon>delete</PaperIcon>
                                        </PaperButton>
                                    }
                                >
                                    {capitalize(describeSchedule(r.schedule))}
                                </PaperListItem>
                            )}
                        </For>
                    </PaperList>
                    {/* a run that went wrong is told under the list, by what it was */}
                    <For each={list()!.filter((r) => r.lastError)}>
                        {(r) => (
                            <PaperQuote variant="danger" icon="error" title={`Last run missed: ${r.what}`}>
                                {r.lastError}
                            </PaperQuote>
                        )}
                    </For>
                </PaperFlex>
            </Match>
        </Switch>
    );
}
