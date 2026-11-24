import { For, Index, Match, Show, Switch, batch, createMemo, createSignal } from "solid-js";
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
import type { IssueSummary } from "../shared";
import { deleteIssue, downloadPrompt, getIssue, listIssues } from "./api";

const RECEIVED = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const RECEIVED_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const SHOWN_IN: Record<IssueSummary["context"]["shell"], string> = { window: "App window", browser: "Browser tab" };

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

function IssueDetail(props: { summary: IssueSummary; onDelete: () => void }) {
    // the full text and diagnostics load when an issue is picked, not with the list
    const full = createRead(getIssue, { source: () => props.summary.id });
    const loaded = () => {
        const issue = full.value();
        return issue?.id === props.summary.id ? issue : undefined;
    };
    return (
        <PaperCard padding="full" surface="front" fullHeight scrollable>
            <PaperFlex direction="column" gap="full">
                <PaperFlex direction="row" align="center" justify="space-between" gap="half" wrap>
                    <PaperText preset="hint">Received {RECEIVED.format(props.summary.receivedAt)}</PaperText>
                    <PaperFlex direction="row" gap="half">
                        <PaperButton variant="outline" onClick={() => props.onDelete()}>
                            <PaperIcon>delete</PaperIcon>
                            Delete
                        </PaperButton>
                        <PaperEffect variant="primary">
                            <PaperButton onClick={() => downloadPrompt(props.summary.id)}>
                                <PaperIcon>download</PaperIcon>
                                Download for an Agent
                            </PaperButton>
                        </PaperEffect>
                    </PaperFlex>
                </PaperFlex>
                <Switch>
                    <Match when={full.error() && !loaded() && !full.loading()}>
                        <PaperError title="Couldn't load the issue" error={full.error()} action={{ label: "Try again", disabled: full.loading(), onClick: () => void full.reload() }} />
                    </Match>
                    <Match when={!loaded()}>
                        <PaperLoader loaderStatus="indeterminate" centered delay={150} label="Loading the issue..." />
                    </Match>
                    <Match when={loaded()}>
                        {(issue) => (
                            <>
                                <PaperFlex direction="column" gap="half">
                                    <IssueText text={issue().text} />
                                </PaperFlex>
                                <Show when={issue().details}>
                                    {(details) => (
                                        <PaperCollapsible title="Logs and diagnostics" icon="receipt_long">
                                            <PaperCode block wrap copyable language="text">
                                                {details()}
                                            </PaperCode>
                                        </PaperCollapsible>
                                    )}
                                </Show>
                            </>
                        )}
                    </Match>
                </Switch>
                <PaperSeparator />
                <PaperKeyValueList>
                    <PaperKeyValue label="Paperboard">{props.summary.context.appVersion}</PaperKeyValue>
                    <PaperKeyValue label="System">
                        {props.summary.context.os} {props.summary.context.osVersion} ({props.summary.context.arch})
                    </PaperKeyValue>
                    <PaperKeyValue label="Shown in">{SHOWN_IN[props.summary.context.shell]}</PaperKeyValue>
                    <PaperKeyValue label="Diagnostics">{props.summary.hasDetails ? "Attached" : "Not sent"}</PaperKeyValue>
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
    const read = createRead(() => listIssues());
    const issues = () => read.value()?.issues ?? [];
    // older pages are fetched on request and appended to what's listed
    const older = createAction();
    const loadOlder = () => {
        const last = issues().at(-1);
        if (!last) return;
        void older.run("Couldn't load older issues", async () => {
            const page = await listIssues(last.receivedAt, last.id);
            // a Reload that landed meanwhile replaced the list: this page continues the old one, so it's dropped
            read.set((prev) => (prev && prev.issues.at(-1)?.id === last.id ? { issues: [...prev.issues, ...page.issues], more: page.more } : prev));
        });
    };

    const [picked, setPicked] = createSignal<string | null>(null);
    // side by side, the detail shows the newest issue until one is picked;
    // collapsed, it's a page that only opens for a picked one
    const [collapsed, setCollapsed] = createSignal(false);
    const shown = createMemo(() => {
        const list = issues();
        return list.find((issue) => issue.id === picked()) ?? (collapsed() ? null : (list[0] ?? null));
    });

    const [deleting, setDeleting] = createSignal<IssueSummary | null>(null);
    const [confirmOpen, setConfirmOpen] = createSignal(false);
    const remove = createAction();
    const askDelete = (issue: IssueSummary) => {
        setDeleting(issue);
        setConfirmOpen(true);
    };
    const confirmDelete = () => {
        const issue = deleting();
        if (!issue) return;
        void remove.run("Couldn't delete the issue", async () => {
            await deleteIssue(issue.id);
            batch(() => {
                read.set((page) => (page ? { ...page, issues: page.issues.filter((found) => found.id !== issue.id) } : page));
                if (picked() === issue.id) setPicked(null);
                setConfirmOpen(false);
            });
        });
    };

    const count = () => {
        const n = issues().length;
        const more = read.value()?.more ? "+" : "";
        return n === 1 && !more ? "1 issue" : `${n}${more} issues`;
    };

    return (
        <PaperPage width="wide" padding="full" gap="full" fullHeight>
            <PaperPageHeader icon="bug_report" title="Issues" subtitle={read.value() ? count() : undefined}>
                <PaperButton variant="outline" disabled={read.loading()} onClick={() => void read.reload()}>
                    <PaperIcon>refresh</PaperIcon>
                    Reload
                </PaperButton>
            </PaperPageHeader>
            <Show when={read.error() && read.value()}>
                <PaperError title="Couldn't reload the issues" error={read.error()} action={{ label: "Try again", disabled: read.loading(), onClick: () => void read.reload() }} />
            </Show>
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
                        detailTitle={shown() ? shown()!.title : undefined}
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
                                                {issue.title}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>
                                <Show when={read.value()?.more}>
                                    <PaperFlex direction="column" align="center" padding="full">
                                        <PaperButton variant="outline" disabled={older.busy()} onClick={loadOlder}>
                                            {older.busy() ? "Loading..." : "Load older issues"}
                                        </PaperButton>
                                    </PaperFlex>
                                </Show>
                            </PaperCard>
                        }
                    >
                        <Show when={shown()} fallback={<PaperEmptyState icon="touch_app" title="Pick an issue" description="Its text and what the app sent with it show here." />}>
                            {(issue) => <IssueDetail summary={issue()} onDelete={() => askDelete(issue())} />}
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
                <PaperText>{deleting() ? `"${deleting()!.title}" is removed from the service for good.` : ""}</PaperText>
            </PaperModal>
        </PaperPage>
    );
}
