import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
    PaperButton,
    PaperCard,
    PaperConsole,
    PaperCopyButton,
    PaperEffect,
    PaperEmptyState,
    PaperError,
    PaperFlex,
    PaperInput,
    PaperMarkdown,
    PaperModal,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    createAction,
    createRead,
    showError,
    showToast,
    type PaperConsoleEntry,
} from "@mileniumhq/paperui";
import { shellIpc } from "../../lib/shell";
import type { IssueReportEntry, IssueReportResult } from "../../../../shared/shellContract";

type Written = Extract<IssueReportResult, { status: "written" }>;

// what the window shows: the description, the agent at work, or the issue it wrote
type Phase = { step: "describe" } | { step: "working"; reportId: string } | { step: "written"; reportId: string; issue: Written };

// a failed tool is an error; a refused one is a warning; the person's own words are commands
function consoleEntry(entry: IssueReportEntry): PaperConsoleEntry {
    switch (entry.kind) {
        case "steer":
            return { type: "command", content: entry.text };
        case "blocked":
            return { type: "warn", content: `Refused: ${entry.text}` };
        case "notice":
            return { type: "info", content: entry.text };
        case "tool":
            return { type: entry.status === "failed" ? "error" : "info", content: entry.text };
        default:
            // the agent's text arrives in chunks that often start or end with blank lines
            return { type: "output", content: entry.text.trim() };
    }
}

const GITHUB = "github";
const linkValue = (index: number) => `link:${index}`;

function gitHubNote(github: NonNullable<Written["github"]>): string {
    switch (github.state) {
        case "signed-in":
            return `Files it in ${github.repo} as ${github.login}.`;
        case "signed-out":
            return "Sign the GitHub CLI in with gh auth login in a terminal to file it from here.";
        default:
            return "Install the GitHub CLI (gh) to file it from here.";
    }
}

/**
 * Report an Issue: a coding agent on this computer reads Paperboard's code,
 * finds the likely cause, and writes the issue, which the person then sends.
 * It stays mounted and opens per request, so PaperModal plays its own open
 * and close.
 */
export default function IssueReport(props: { open: boolean; onClose: () => void }) {
    // read afresh each time it opens: an agent may have been installed since
    const setup = createRead(() => shellIpc().invoke("issue-report-setup"), { source: () => props.open });

    const [description, setDescription] = createSignal("");
    const [pickedAgent, setPickedAgent] = createSignal<string | null>(null);
    const agent = () => {
        const agents = setup.value()?.agents ?? [];
        const picked = pickedAgent();
        return agents.find((found) => found.id === picked)?.id ?? agents[0]?.id ?? null;
    };

    const [phase, setPhase] = createSignal<Phase>({ step: "describe" });
    const reportId = () => {
        const now = phase();
        return now.step === "describe" ? null : now.reportId;
    };

    // what the agent did, each line kept under its id as it changes
    const [entries, setEntries] = createStore<IssueReportEntry[]>([]);
    const consoleEntries = createMemo(() => entries.map(consoleEntry));
    onCleanup(
        shellIpc().on("issue-report-entry", (entry) => {
            const now = phase();
            if (now.step !== "working" || now.reportId !== entry.reportId) return;
            setEntries(
                produce((list) => {
                    const at = list.findIndex((line) => line.id === entry.id);
                    if (at === -1) list.push(entry);
                    else list[at] = entry;
                }),
            );
        }),
    );

    const start = () => {
        const chosen = agent();
        if (!chosen) return;
        const id = crypto.randomUUID();
        setEntries([]);
        setPhase({ step: "working", reportId: id });
        // a report that was stopped or replaced has no one to answer
        const current = () => reportId() === id;
        shellIpc()
            .invoke("issue-report-start", { reportId: id, description: description(), agent: chosen })
            .then(
                (result) => {
                    if (!current()) return;
                    if (result.status === "stopped") setPhase({ step: "describe" });
                    else setPhase({ step: "written", reportId: id, issue: result });
                },
                (err) => {
                    if (!current()) return;
                    setPhase({ step: "describe" });
                    showError("Couldn't write the issue", err);
                },
            );
    };

    // the description stays, so the person can change it and try again
    const stop = () => {
        const now = phase();
        if (now.step !== "working") return;
        setPhase({ step: "describe" });
        shellIpc()
            .invoke("issue-report-stop", { reportId: now.reportId })
            .catch((err) => showError("Couldn't stop the agent", err));
    };

    const steer = (text: string) => {
        const id = reportId();
        if (!id) return;
        shellIpc()
            .invoke("issue-report-steer", { reportId: id, text })
            .catch((err) => showError("Couldn't tell the agent", err));
    };

    const close = () => {
        stop();
        if (phase().step === "written") setPhase({ step: "describe" });
        props.onClose();
    };

    // where the written issue goes: GitHub when the CLI can file it, else the config's first link
    const [destination, setDestination] = createSignal<string | null>(null);
    createEffect(
        on(phase, (now) => {
            if (now.step !== "written") return;
            setDestination(now.issue.github?.state === "signed-in" ? GITHUB : setup.value()?.links.length ? linkValue(0) : null);
        }),
    );

    const send = createAction();
    const sendLabel = () => {
        const chosen = destination();
        if (chosen === GITHUB) return "File on GitHub";
        const link = chosen ? setup.value()?.links[Number(chosen.slice("link:".length))] : undefined;
        return link ? `Open ${link.label}` : "Send";
    };
    const sendIssue = (now: Extract<Phase, { step: "written" }>) => {
        const chosen = destination();
        if (!chosen) return;
        void send.run("Couldn't send the issue", async () => {
            if (chosen === GITHUB) {
                const url = await shellIpc().invoke("issue-report-file", { reportId: now.reportId });
                showToast({ variant: "success", title: "Issue filed", message: url, action: { label: "Open", onClick: () => window.open(url) } });
            } else {
                await shellIpc().invoke("issue-report-open-link", { reportId: now.reportId, index: Number(chosen.slice("link:".length)) });
            }
            setDescription("");
            setPhase({ step: "describe" });
            props.onClose();
        });
    };

    const written = () => {
        const now = phase();
        return now.step === "written" ? now : null;
    };

    return (
        <PaperModal
            open={props.open}
            title="Report an Issue"
            size="large"
            onClose={close}
            footer={
                <Switch>
                    <Match when={phase().step === "describe"}>
                        <PaperButton variant="text" onClick={close}>Cancel</PaperButton>
                        <PaperEffect variant="primary">
                            <PaperButton disabled={!description().trim() || !agent()} onClick={start}>Investigate</PaperButton>
                        </PaperEffect>
                    </Match>
                    <Match when={phase().step === "working"}>
                        <PaperButton variant="danger" onClick={stop}>Stop</PaperButton>
                    </Match>
                    <Match when={written()}>
                        {(now) => (
                            <>
                                <PaperButton variant="text" disabled={send.busy()} onClick={() => setPhase({ step: "describe" })}>Start over</PaperButton>
                                <PaperCopyButton text={now().issue.text} label="Copy issue" variant="outline" />
                                <PaperEffect variant="primary">
                                    <PaperButton disabled={send.busy() || !destination()} onClick={() => sendIssue(now())}>
                                        {send.busy() ? "Sending..." : sendLabel()}
                                    </PaperButton>
                                </PaperEffect>
                            </>
                        )}
                    </Match>
                </Switch>
            }
        >
            <Switch>
                <Match when={setup.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't get ready to report"
                            error={err()}
                            action={{ label: "Try again", disabled: setup.loading(), onClick: () => void setup.reload() }}
                        />
                    )}
                </Match>
                <Match when={phase().step === "describe" && setup.value()}>
                    {(ready) => (
                        <Show
                            when={ready().agents.length}
                            fallback={
                                <PaperEmptyState
                                    icon="smart_toy"
                                    title="No coding agent found"
                                    description={`A coding agent on this computer reads Paperboard's code and writes the issue. Install one of ${ready().known.join(", ")}, then open this again.`}
                                />
                            }
                        >
                            <PaperFlex direction="column" gap="full">
                                <PaperInput
                                    label={ready().prompt}
                                    multiline
                                    rows={5}
                                    fullWidth
                                    value={description()}
                                    onInput={(event) => setDescription(event.currentTarget.value)}
                                />
                                <PaperFlex direction="column" gap="half">
                                    <PaperText preset="label">Agent</PaperText>
                                    <PaperSelector name="issue-report-agent" horizontal value={agent() ?? undefined} onValueChange={(value) => setPickedAgent(String(value))}>
                                        <For each={ready().agents}>
                                            {(found) => <PaperSelectorItem value={found.id} icon="smart_toy">{found.name}</PaperSelectorItem>}
                                        </For>
                                    </PaperSelector>
                                </PaperFlex>
                                <PaperText preset="hint">
                                    What you write goes to the agent you pick. It reads Paperboard's code and can't change anything on this computer. The issue it writes goes nowhere until you send it.
                                </PaperText>
                            </PaperFlex>
                        </Show>
                    )}
                </Match>
                <Match when={phase().step === "working"}>
                    <PaperCard padding="full" height="panel-height-small" surface="front">
                        <PaperConsole
                            entries={consoleEntries()}
                            title="Investigating"
                            placeholder="Tell the agent more..."
                            onCommand={steer}
                            empty={<PaperEmptyState icon="hourglass_top" title="Getting Paperboard's code" />}
                        />
                    </PaperCard>
                </Match>
                <Match when={written()}>
                    {(now) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperText preset="subheader">{now().issue.title}</PaperText>
                            <PaperCard padding="full" surface="front">
                                <PaperMarkdown text={now().issue.body} />
                            </PaperCard>
                            <PaperFlex direction="column" gap="half">
                                <PaperText preset="label">Send it to</PaperText>
                                <PaperSelector name="issue-report-destination" value={destination() ?? undefined} onValueChange={(value) => setDestination(String(value))}>
                                    <Show when={now().issue.github}>
                                        {(github) => (
                                            <PaperSelectorItem value={GITHUB} icon="bug_report" description={gitHubNote(github())} disabled={github().state !== "signed-in"}>
                                                GitHub
                                            </PaperSelectorItem>
                                        )}
                                    </Show>
                                    <For each={setup.value()?.links ?? []}>
                                        {(link, index) => (
                                            <PaperSelectorItem value={linkValue(index())} icon="open_in_new" description={link.description}>
                                                {link.label}
                                            </PaperSelectorItem>
                                        )}
                                    </For>
                                </PaperSelector>
                            </PaperFlex>
                        </PaperFlex>
                    )}
                </Match>
            </Switch>
        </PaperModal>
    );
}
