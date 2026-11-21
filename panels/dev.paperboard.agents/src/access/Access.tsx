// What the agent may do on the user's own computer: the shells it has open,
// which the user can close, and the folders and shells they allowed, always
// or for this time, which they can take back. The agent asks in the chat;
// this page follows every change as it happens.

import { For, Match, Show, Switch } from "solid-js";
import { PaperButton, PaperEmptyState, PaperError, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperListLabel, PaperLoader, createRead, showError } from "@mileniumhq/paperui";
import type { AccessGrant, AccessView, UserShellView } from "../contract";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { localStamp } from "../routineText";
import { itemText } from "../chat/AccessRequest";

const grantKey = (g: AccessGrant) => `${g.kind}:${g.kind === "folder" ? g.path : ""}:${g.once}:${g.at}`;
const shellKey = (s: UserShellView) => `${s.id}:${s.opened}`;

export default function Access(props: { agent: Agent }) {
    const name = () => props.agent.name();
    // each grant and shell keyed by what it is, so a change, read or pushed, touches only what changed
    const shape = (view: AccessView) => ({
        error: view.error,
        grants: view.grants.map((grant) => ({ key: grantKey(grant), grant })),
        shells: view.shells.map((shell) => ({ key: shellKey(shell), shell })),
    });
    // a change pushed while the first read is out is newer than it: the read doesn't replace it
    const access = createRead(() => props.agent.calls.access().then(shape), {
        key: "key",
        follow: (land) => props.agent.events.access((next) => land(shape(next))),
    });
    const view = access.value;
    const grants = () => view()?.grants ?? [];
    const shells = () => view()?.shells ?? [];
    holdPage(access.ready());

    const revoke = (g: AccessGrant) =>
        props.agent.calls
            .revokeAccess({ grant: g.kind === "folder" ? { kind: "folder", path: g.path } : { kind: "shell" } })
            .then((next) => access.set(shape(next)))
            .catch((e) => showError(`Couldn't take back ${g.kind === "folder" ? g.path : "shells"}`, e));

    const close = (s: UserShellView) =>
        props.agent.calls
            .closeShell({ id: s.id })
            .then((next) => access.set(shape(next)))
            .catch((e) => showError(`Couldn't close the shell for ${s.task}`, e));

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
                        when={grants().length > 0 || shells().length > 0}
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
                            <Show when={shells().length > 0}>
                                <PaperListLabel as="h3">Open shells</PaperListLabel>
                                <For each={shells()}>
                                    {(row) => {
                                        const s = row.shell;
                                        return (
                                            <PaperListItem
                                                value={`shell:${s.id}`}
                                                icon="terminal"
                                                description={`${s.running ? `Running ${s.running}` : "At its prompt"} · opened in ${s.folder} ${localStamp(s.opened)}`}
                                                actions={
                                                    <PaperButton icon size="small" variant="text" aria-label={`Close the shell for ${s.task}`} title="Close this shell" onClick={() => void close(s)}>
                                                        <PaperIcon>close</PaperIcon>
                                                    </PaperButton>
                                                }
                                            >
                                                {s.task}
                                            </PaperListItem>
                                        );
                                    }}
                                </For>
                            </Show>
                            <Show when={grants().length > 0}>
                                <PaperListLabel as="h3">Allowed</PaperListLabel>
                                <For each={grants()}>
                                    {(row) => {
                                        const g = row.grant;
                                        const t = itemText(g);
                                        return (
                                            <PaperListItem
                                                value={`${g.kind}:${t.what}:${g.once}`}
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
                            </Show>
                        </PaperList>
                    </Show>
                </PaperFlex>
            </Match>
        </Switch>
    );
}
