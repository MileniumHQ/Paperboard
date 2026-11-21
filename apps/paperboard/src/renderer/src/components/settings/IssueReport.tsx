import { For, Match, Show, Switch, batch, createSignal, onCleanup } from "solid-js";
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
    PaperLink,
    PaperLoader,
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
import { AgentIcon } from "./AgentIcon";
import {
    GITHUB_DESTINATION,
    defaultDestination,
    joinOr,
    linkDescription,
    linkIndex,
    linkValue,
    upsertConsoleEntry,
    type WrittenReport,
} from "./issueReportModel";

// what the window shows: the description, the agent at work, or the issue it wrote
type Phase =
    | { step: "describe" }
    | { step: "working"; reportId: string }
    | { step: "written"; reportId: string; issue: WrittenReport };

const REPORT_DOCS_URL = "https://paperboard.dev/docs/paperboard/troubleshooting/#report-an-issue";

function gitHubNote(github: NonNullable<WrittenReport["github"]>): string {
    switch (github.state) {
        case "signed-in":
            return `Files it in ${github.repo} as ${github.login}.`;
        case "signed-out":
            return "Sign the GitHub CLI in with gh auth login in a terminal to file it from here.";
        case "error":
            return `Couldn't check the GitHub CLI: ${github.error ?? "unknown error"}`;
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
    const [phase, setPhase] = createSignal<Phase>({ step: "describe" });
    const reportId = () => {
        const now = phase();
        return now.step === "describe" ? null : now.reportId;
    };

    // read afresh each time the form opens: an agent may have been installed since,
    // without touching an already-written issue when the modal is reopened
    const setup = createRead(() => shellIpc().invoke("issue-report-setup"), {
        source: () => props.open && phase().step === "describe",
    });

    const [description, setDescription] = createSignal("");
    const [pickedAgent, setPickedAgent] = createSignal<string | null>(null);
    const agent = () => {
        const agents = setup.value()?.agents ?? [];
        const picked = pickedAgent();
        return agents.find((found) => found.id === picked)?.id ?? agents[0]?.id ?? null;
    };

    // what the agent did, converted once per update so untouched rows keep their identity
    const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([]);
    onCleanup(
        shellIpc().on("issue-report-entry", (entry) => {
            const now = phase();
            if (now.step !== "working" || now.reportId !== entry.reportId) return;
            setEntries((list) => upsertConsoleEntry(list, entry));
        }),
    );

    // where the written issue goes: set when the issue finishes, then chosen by the user
    const [destination, setDestination] = createSignal<string | null>(null);

    const start = () => {
        const chosen = agent();
        if (!chosen) return;
        const id = crypto.randomUUID();
        batch(() => {
            setEntries([]);
            setPhase({ step: "working", reportId: id });
        });
        // a report that was stopped or replaced has no one to answer
        const current = () => reportId() === id;
        shellIpc()
            .invoke("issue-report-start", { reportId: id, description: description(), agent: chosen })
            .then(
                (result) => {
                    if (!current()) return;
                    if (result.status === "stopped") {
                        setPhase({ step: "describe" });
                    } else {
                        batch(() => {
                            setDestination(defaultDestination(result, setup.value()?.links ?? []));
                            setPhase({ step: "written", reportId: id, issue: result });
                        });
                    }
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
    onCleanup(stop);

    const steer = (text: string) => {
        const id = reportId();
        if (!id) return;
        shellIpc()
            .invoke("issue-report-steer", { reportId: id, text })
            .catch((err) => showError("Couldn't tell the agent", err));
    };

    const send = createAction();
    const busy = () => phase().step === "working" || send.busy();

    // closing never discards a written issue or stops a run: Stop or Start over is explicit
    const close = () => {
        if (!busy()) props.onClose();
    };

    const selectedLink = () => {
        const index = linkIndex(destination());
        return index === null ? undefined : setup.value()?.links[index];
    };

    const sendLabel = () => {
        if (destination() === GITHUB_DESTINATION) return "File on GitHub";
        const link = selectedLink();
        if (!link) return "Send";
        return link.includesIssue ? `Open ${link.label}` : `Copy and open ${link.label}`;
    };

    const sendIssue = (now: Extract<Phase, { step: "written" }>) => {
        const chosen = destination();
        if (!chosen) return;
        void send.run("Couldn't send the issue", async () => {
            if (chosen === GITHUB_DESTINATION) {
                const url = await shellIpc().invoke("issue-report-file", { reportId: now.reportId });
                showToast({ variant: "success", title: "Issue filed", message: url, action: { label: "Open", onClick: () => window.open(url) } });
                batch(() => {
                    setDescription("");
                    setPhase({ step: "describe" });
                });
                props.onClose();
                return;
            }
            const index = linkIndex(chosen);
            if (index === null) return;
            const link = setup.value()?.links[index];
            await shellIpc().invoke("issue-report-open-link", { reportId: now.reportId, index });
            // external links hand off to another app, so keep the written issue until Start over
            if (link && !link.includesIssue) {
                showToast({ variant: "success", title: "Issue copied", message: `Paste it into ${link.label}.` });
            }
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
            onClose={busy() ? undefined : close}
            closeOnEsc={!busy()}
            closeOnBackdropClick={!busy()}
            footer={
                <Switch>
                    <Match when={phase().step === "describe"}>
                        <PaperButton variant="text" onClick={close}>
                            {agent() ? "Cancel" : "Close"}
                        </PaperButton>
                        <Show when={agent()}>
                            <PaperEffect variant="primary">
                                <PaperButton disabled={!description().trim()} onClick={start}>
                                    Investigate
                                </PaperButton>
                            </PaperEffect>
                        </Show>
                    </Match>
                    <Match when={phase().step === "working"}>
                        <PaperButton variant="danger" onClick={stop}>
                            Stop
                        </PaperButton>
                    </Match>
                    <Match when={written()}>
                        {(now) => (
                            <>
                                <PaperButton variant="text" disabled={send.busy()} onClick={() => setPhase({ step: "describe" })}>
                                    Start over
                                </PaperButton>
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
                <Match when={phase().step === "describe" && setup.error()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't get ready to report"
                            error={err()}
                            action={{ label: "Try again", disabled: setup.loading(), onClick: () => void setup.reload() }}
                        />
                    )}
                </Match>
                <Match when={phase().step === "describe" && !setup.value()}>
                    <PaperLoader loaderStatus="indeterminate" centered delay={150} label="Looking for coding agents..." />
                </Match>
                <Match when={phase().step === "describe" && setup.value()}>
                    {(ready) => (
                        <Show
                            when={ready().agents.length}
                            fallback={
                                <PaperEmptyState
                                    icon="smart_toy"
                                    title="No coding agent found"
                                    description={
                                        <>
                                            A coding agent on this computer reads Paperboard's code and writes the issue. Install one such as{" "}
                                            {joinOr(ready().known)}, or another supported agent listed in{" "}
                                            <PaperLink href={REPORT_DOCS_URL} target="_blank" rel="noopener noreferrer">
                                                Report an issue
                                            </PaperLink>
                                            , then check again.
                                        </>
                                    }
                                >
                                    <PaperButton variant="outline" size="small" disabled={setup.loading()} onClick={() => void setup.reload()}>
                                        Check again
                                    </PaperButton>
                                </PaperEmptyState>
                            }
                        >
                            <PaperFlex direction="column" gap="full">
                                <PaperInput
                                    label={ready().prompt}
                                    placeholder="Describe what happened and what you expected..."
                                    autofocus
                                    multiline
                                    rows={5}
                                    fullWidth
                                    value={description()}
                                    onInput={(event) => setDescription(event.currentTarget.value)}
                                />
                                <PaperFlex direction="column" gap="half">
                                    <PaperText preset="label">Agent</PaperText>
                                    <PaperSelector
                                        name="issue-report-agent"
                                        horizontal
                                        value={agent() ?? undefined}
                                        onValueChange={(value) => setPickedAgent(String(value))}
                                    >
                                        <For each={ready().agents}>
                                            {(found) => (
                                                <PaperSelectorItem value={found.id} icon={<AgentIcon id={found.id} />}>
                                                    {found.name}
                                                </PaperSelectorItem>
                                            )}
                                        </For>
                                    </PaperSelector>
                                </PaperFlex>
                                <PaperText preset="hint">
                                    What you write goes to the agent you pick. It reads Paperboard's code and can't change anything on this computer. The issue it
                                    writes goes nowhere until you send it.
                                </PaperText>
                            </PaperFlex>
                        </Show>
                    )}
                </Match>
                <Match when={phase().step === "working"}>
                    <PaperCard padding="full" height="panel-height-small" surface="front">
                        <PaperConsole
                            entries={entries()}
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
                                <PaperSelector
                                    name="issue-report-destination"
                                    value={destination() ?? undefined}
                                    onValueChange={(value) => setDestination(String(value))}
                                >
                                    <Show when={now().issue.github}>
                                        {(github) => (
                                            <PaperSelectorItem
                                                value={GITHUB_DESTINATION}
                                                icon="bug_report"
                                                description={gitHubNote(github())}
                                                disabled={github().state !== "signed-in"}
                                            >
                                                GitHub
                                            </PaperSelectorItem>
                                        )}
                                    </Show>
                                    <For each={setup.value()?.links ?? []}>
                                        {(link, index) => (
                                            <PaperSelectorItem value={linkValue(index())} icon="open_in_new" description={linkDescription(link)}>
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
