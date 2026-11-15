// What the agent may do on the user's own computer: the folders and commands
// they allowed, always or for this time, and taking any of them back. The
// agent asks in the chat; this page follows every change as it happens.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperQuote, createRead } from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import type { AccessGrant, AccessView } from "../contract";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { localStamp } from "../routineText";
import { itemText } from "../chat/AccessRequest";

const grantKey = (g: AccessGrant) => `${g.kind}:${itemText(g).what}:${g.kind === "command" && g.anyArguments}:${g.once}:${g.at}`;

export default function Access(props: { agent: Agent }) {
    const name = () => props.agent.name();
    // each grant keyed by what it is, so a change, read or pushed, touches only what changed
    const shape = (view: AccessView) => ({ error: view.error, grants: view.grants.map((grant) => ({ key: grantKey(grant), grant })) });
    // a change pushed while the first read is out is newer than it: the read doesn't replace it
    const access = createRead(() => props.agent.calls.access().then(shape), { key: "key", follow: (land) => props.agent.events.access((next) => land(shape(next))) });
    const view = access.value;
    const grants = () => view()?.grants ?? [];
    const [failed, setFailed] = createSignal<string | null>(null);
    holdPage(access.ready());

    const revoke = async (g: AccessGrant) => {
        setFailed(null);
        try {
            access.set(shape(await props.agent.calls.revokeAccess({ grant: g.kind === "folder" ? { kind: "folder", path: g.path } : { kind: "command", command: g.command, anyArguments: g.anyArguments } })));
        } catch (e) {
            setFailed(errorMessage(e));
        }
    };

    return (
        <Switch>
            <Match when={access.error()}>
                {(why) => (
                    <PaperFlex padding="double">
                        <PaperEmptyState icon="error" title="Access can't be read" description={why()}>
                            <PaperButton onClick={() => void access.reload()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </PaperFlex>
                )}
            </Match>
            <Match when={view() === undefined}>
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
                        when={grants().length > 0}
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
                            <For each={grants()}>
                                {(row) => {
                                    const g = row.grant;
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
