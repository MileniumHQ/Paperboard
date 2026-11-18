// What the agent may do on the user's own computer: the folders and commands
// they allowed, always or for this time, and taking any of them back. The
// agent asks in the chat; this page follows every change as it happens.

import { For, Match, Show, Switch } from "solid-js";
import { PaperButton, PaperEmptyState, PaperError, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, createRead, showError } from "@mileniumhq/paperui";
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
    const access = createRead(() => props.agent.calls.access().then(shape), {
        key: "key",
        follow: (land) => props.agent.events.access((next) => land(shape(next))),
    });
    const view = access.value;
    const grants = () => view()?.grants ?? [];
    holdPage(access.ready());

    const revoke = (g: AccessGrant) =>
        props.agent.calls
            .revokeAccess({ grant: g.kind === "folder" ? { kind: "folder", path: g.path } : { kind: "command", command: g.command, anyArguments: g.anyArguments } })
            .then((next) => access.set(shape(next)))
            .catch((e) => showError(`Couldn't take back ${itemText(g).what}`, e));

    return (
        <Switch>
            <Match when={view() === undefined && access.error()}>
                {(err) => <PaperError fill title="Couldn't load what's allowed" error={err()} action={{ label: "Try again", disabled: access.loading(), onClick: () => void access.reload() }} />}
            </Match>
            <Match when={view() === undefined}>
                <PaperFlex padding="double">
                    <PaperLoader loaderStatus="indeterminate" label="Reading what's allowed" />
                </PaperFlex>
            </Match>
            <Match when={true}>
                {/* the grants file couldn't be read when the service started: nothing it held is allowed, and the words say how to fix it */}
                <Show when={view()!.error}>
                    {(err) => (
                        <PaperFlex padding="full">
                            <PaperError title="Couldn't read what you allowed" error={err()} />
                        </PaperFlex>
                    )}
                </Show>
                <PaperFlex flex minHeight={0}>
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
                        <PaperList selectable={false} borderless fullWidth fullHeight background="transparent">
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
