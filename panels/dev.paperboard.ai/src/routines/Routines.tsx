// What the agent does on a schedule. It sets routines up when asked in the
// chat; here the user sees them, when each runs next, how the last run went,
// and can stop any of them. The list follows the service's routines revision.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperLoader, PaperText } from "@mileniumhq/paperui";
import type { Routine } from "../contract";
import { describeSchedule, localStamp } from "../routineText";
import type { Agent } from "../lib/agent";
import styles from "./Routines.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
            if (!gone && mine === reads) setError(message(e));
        }
    };
    createEffect(on(() => agent.state.routines.revision, () => void load()));

    const stop = async (r: Routine) => {
        setFailed(null);
        try {
            await agent.deleteRoutine(r.id);
        } catch (e) {
            setFailed(message(e));
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
                <div class={styles.routines}>
                    <Show when={failed()}>
                        <PaperText size={1} color="danger" role="alert">
                            {failed()}
                        </PaperText>
                    </Show>
                    <For each={list()!}>
                        {(r) => (
                            <div class={styles.routine}>
                                <div class={styles.text}>
                                    <PaperText>{r.what}</PaperText>
                                    <PaperText size={1} color="muted">
                                        {describeSchedule(r.schedule)}
                                        {r.next ? ` · next ${localStamp(r.next)}` : ""}
                                        {r.lastRun ? ` · last ran ${localStamp(r.lastRun)}` : ""}
                                    </PaperText>
                                    <Show when={r.lastError}>
                                        <PaperText size={1} color="danger">
                                            Its last run didn't happen: {r.lastError}
                                        </PaperText>
                                    </Show>
                                </div>
                                <PaperButton icon size="small" variant="danger" aria-label={`Stop: ${r.what}`} title="Stop this routine" onClick={() => void stop(r)}>
                                    <PaperIcon>delete</PaperIcon>
                                </PaperButton>
                            </div>
                        )}
                    </For>
                </div>
            </Match>
        </Switch>
    );
}
