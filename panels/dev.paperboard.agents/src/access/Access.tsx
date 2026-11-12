// What the agent may do on the user's own computer: the folders and commands
// they allowed, always or for this time, and taking any of them back. The
// agent asks in the chat; this page follows every change as it happens.

import { For, Match, Show, Switch, createSignal, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperQuote } from "@mileniumhq/paperui";
import type { AccessGrant, AccessView } from "../contract";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { errorText } from "../lib/failure";
import { localStamp } from "../routineText";
import { itemText } from "../chat/AccessRequest";

export default function Access(props: { agent: Agent }) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";
    const [view, setView] = createSignal<AccessView | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [failed, setFailed] = createSignal<string | null>(null);

    let gone = false;
    onCleanup(() => (gone = true));
    // a change pushed while the first read is out is newer than it: the read doesn't replace it
    let pushed = false;
    onCleanup(
        agent.onAccess((next) => {
            pushed = true;
            if (!gone) setView(next);
        }),
    );
    const load = async () => {
        pushed = false;
        try {
            const next = await agent.access();
            if (!gone && !pushed) setView(next);
            setError(null);
        } catch (e) {
            if (!gone) setError(errorText(e));
        }
    };
    holdPage(load());

    const revoke = async (g: AccessGrant) => {
        setFailed(null);
        try {
            setView(await agent.revokeAccess(g.kind === "folder" ? { kind: "folder", path: g.path } : { kind: "command", command: g.command, anyArguments: g.anyArguments }));
        } catch (e) {
            setFailed(errorText(e));
        }
    };

    return (
        <Switch>
            <Match when={error()}>
                {(why) => (
                    <PaperFlex padding="double">
                        <PaperEmptyState icon="error" title="Access can't be read" description={why()}>
                            <PaperButton onClick={() => void load()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </PaperFlex>
                )}
            </Match>
            <Match when={view() === null}>
                <PaperFlex padding="double">
                    <PaperLoader loaderStatus="indeterminate" label="Reading what's allowed" />
                </PaperFlex>
            </Match>
            <Match when={true}>
                <PaperFlex flex minHeight={0}>
                    <Show when={view()!.error}>
                        <PaperFlex padding="full">
                            <PaperQuote variant="danger" icon="error" title="What you allowed can't be read" role="alert">
                                {view()!.error}
                            </PaperQuote>
                        </PaperFlex>
                    </Show>
                    <Show when={failed()}>
                        <PaperFlex padding="full">
                            <PaperQuote variant="danger" icon="error" title="Not taken back" role="alert">
                                {failed()}
                            </PaperQuote>
                        </PaperFlex>
                    </Show>
                    <Show
                        when={view()!.grants.length > 0}
                        fallback={
                            <PaperFlex padding="double">
                                <PaperEmptyState
                                    icon="shield_person"
                                    title="Nothing on your computer"
                                    description={`${name()} works on its own computer. When you want something fixed or changed on yours, it asks first, and what you always allow shows here.`}
                                />
                            </PaperFlex>
                        }
                    >
                        <PaperList selectable={false} borderless fullWidth fullHeight>
                            <For each={view()!.grants}>
                                {(g) => {
                                    const t = itemText(g);
                                    return (
                                        <PaperListItem
                                            value={`${g.kind}:${t.what}:${g.kind === "command" && g.anyArguments}:${g.once}`}
                                            icon={t.icon}
                                            description={`${t.how} · ${g.once ? "this time only" : `allowed ${localStamp(g.at)}`}`}
                                            actions={
                                                <PaperButton icon size="small" variant="text" aria-label={`Take back ${t.what}`} title="Take this back" onClick={() => void revoke(g)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            }
                                        >
                                            {t.what}
                                        </PaperListItem>
                                    );
                                }}
                            </For>
                        </PaperList>
                    </Show>
                </PaperFlex>
            </Match>
        </Switch>
    );
}
