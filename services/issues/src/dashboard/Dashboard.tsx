import { For, Index, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperCollapsible,
    PaperEffect,
    PaperEmptyState,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperKeyValue,
    PaperKeyValueList,
    PaperList,
    PaperListItem,
    PaperLoader,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperSeparator,
    PaperSplit,
    PaperText,
    createAction,
    createRead,
} from "@mileniumhq/paperui";
import type { Issue } from "../shared";
import { deleteIssue, downloadPrompt, listIssues } from "./api";

const RECEIVED = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const RECEIVED_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const SHOWN_IN: Record<Issue["context"]["shell"], string> = { window: "App window", browser: "Browser tab" };

// an issue's name in the list: its first line, as the person started it
const titleOf = (issue: Issue) => issue.text.split("\n", 1)[0]!;
const paragraphsOf = (text: string) => text.split(/\n{2,}/);

/** The text as the person typed it: paragraphs and line breaks kept, nothing rendered as markup. */
function IssueText(props: { text: string }) {
    return (
        <Index each={paragraphsOf(props.text)}>
            {(paragraph) => (
                <PaperText preset="body" as="p" breakWord>
                    <Index each={paragraph().split("\n")}>
                        {(line, i) => (
                            <>
                                <Show when={i > 0}>
                                    <br />
                                </Show>
                                {line()}
                            </>
                        )}
                    </Index>
                </PaperText>
            )}
        </Index>
    );
}

function IssueDetail(props: { issue: Issue; onDelete: () => void }) {
    return (
        <PaperCard padding="full" surface="front" fullHeight scrollable>
            <PaperFlex direction="column" gap="full">
                <PaperFlex direction="row" align="center" justify="space-between" gap="half" wrap>
                    <PaperText preset="hint">Received {RECEIVED.format(props.issue.receivedAt)}</PaperText>
                    <PaperFlex direction="row" gap="half">
                        <PaperButton variant="outline" onClick={() => props.onDelete()}>
                            <PaperIcon>delete</PaperIcon>
                            Delete
                        </PaperButton>
                        <PaperEffect variant="primary">
                            <PaperButton onClick={() => downloadPrompt(props.issue.id)}>
                                <PaperIcon>download</PaperIcon>
                                Download for an Agent
                            </PaperButton>
                        </PaperEffect>
                    </PaperFlex>
                </PaperFlex>
                <PaperFlex direction="column" gap="half">
                    <IssueText text={props.issue.text} />
                </PaperFlex>
                <Show when={props.issue.details}>
                    {(details) => (
                        <PaperCollapsible title="Logs and diagnostics" icon="receipt_long">
                            <PaperCode block wrap copyable language="text">
                                {details()}
                            </PaperCode>
                        </PaperCollapsible>
                    )}
                </Show>
                <PaperSeparator />
                <PaperKeyValueList>
                    <PaperKeyValue label="Paperboard">{props.issue.context.appVersion}</PaperKeyValue>
                    <PaperKeyValue label="System">
                        {props.issue.context.os} {props.issue.context.osVersion} ({props.issue.context.arch})
                    </PaperKeyValue>
                    <PaperKeyValue label="Shown in">{SHOWN_IN[props.issue.context.shell]}</PaperKeyValue>
                    <PaperKeyValue label="Diagnostics">{props.issue.details ? "Attached" : "Not sent"}</PaperKeyValue>
                </PaperKeyValueList>
            </PaperFlex>
        </PaperCard>
    );
}

/**
 * The issues people sent from Report an Issue, newest first. Each one
 * downloads as a prompt a coding agent runs to open a GitHub issue and a
 * pull request.
 */
export default function Dashboard() {
    const read = createRead(listIssues);
    const issues = () => read.value() ?? [];

    const [picked, setPicked] = createSignal<string | null>(null);
    // side by side, the detail shows the newest issue until one is picked;
    // collapsed, it's a page that only opens for a picked one
    const [collapsed, setCollapsed] = createSignal(false);
    const shown = createMemo(() => {
        const list = issues();
        return list.find((issue) => issue.id === picked()) ?? (collapsed() ? null : (list[0] ?? null));
    });

    const [deleting, setDeleting] = createSignal<Issue | null>(null);
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const remove = createAction();
    const askDelete = (issue: Issue) => {
        setDeleting(issue);
        setConfirmOpen(true);
    };
    const confirmDelete = () => {
        const issue = deleting();
        if (!issue) return;
        void remove.run("Couldn't delete the issue", async () => {
            await deleteIssue(issue.id);
            read.set((list) => list?.filter((found) => found.id !== issue.id));
            if (picked() === issue.id) setPicked(null);
            setConfirmOpen(false);
        });
    };

    const count = () => {
        const n = issues().length;
        return n === 1 ? "1 issue" : `${n} issues`;
    };

    return (
        <PaperPage width="wide" padding="full" gap="full" fullHeight>
            <PaperPageHeader icon="bug_report" title="Issues" subtitle={read.value() ? count() : undefined}>
                <PaperButton variant="outline" disabled={read.loading()} onClick={() => void read.reload()}>
                    <PaperIcon>refresh</PaperIcon>
                    Reload
                </PaperButton>
            </PaperPageHeader>
            <Switch>
                <Match when={read.error() && !read.value()}>
                    <PaperError title="Couldn't load the issues" error={read.error()} action={{ label: "Try again", disabled: read.loading(), onClick: () => void read.reload() }} />
                </Match>
                <Match when={!read.value()}>
                    <PaperLoader loaderStatus="indeterminate" centered delay={150} label="Loading issues..." />
                </Match>
                <Match when={issues().length === 0}>
                    <PaperEmptyState icon="inbox" title="No issues" description="Issues people send from Report an Issue in the app show up here." />
                </Match>
                <Match when={issues().length > 0}>
                    <PaperSplit
                        detailActive={shown() !== null}
                        onDetailClose={() => setPicked(null)}
                        onCollapsedChange={setCollapsed}
                        detailTitle={shown() ? titleOf(shown()!) : undefined}
                        side={
                            <PaperCard surface="front" fullHeight scrollable>
                                <PaperList name="issues" value={shown()?.id ?? ""} onValueChange={(value) => setPicked(String(value))} fullWidth borderless>
                                    <For each={issues()}>
                                        {(issue) => (
                                            <PaperListItem
                                                value={issue.id}
                                                icon="bug_report"
                                                description={`${RECEIVED_SHORT.format(issue.receivedAt)} · ${issue.context.os}`}
                                            >
                                                {titleOf(issue)}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>
                            </PaperCard>
                        }
                    >
                        <Show when={shown()} fallback={<PaperEmptyState icon="touch_app" title="Pick an issue" description="Its text and what the app sent with it show here." />}>
                            {(issue) => <IssueDetail issue={issue()} onDelete={() => askDelete(issue())} />}
                        </Show>
                    </PaperSplit>
                </Match>
            </Switch>
            <PaperModal
                open={confirmOpen()}
                title="Delete this issue?"
                onClose={remove.busy() ? undefined : () => setConfirmOpen(false)}
                footer={
                    <>
                        <PaperButton variant="text" disabled={remove.busy()} onClick={() => setConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" disabled={remove.busy()} onClick={confirmDelete}>
                            {remove.busy() ? "Deleting..." : "Delete"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText>{deleting() ? `"${titleOf(deleting()!)}" is removed from the service for good.` : ""}</PaperText>
            </PaperModal>
        </PaperPage>
    );
}
