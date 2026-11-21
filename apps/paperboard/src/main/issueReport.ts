// Report an issue: App Settings asks a coding agent already on this computer
// (Claude Code, Codex, …) to read Paperboard's code and write the issue up,
// with trissue. The agent only reads: trissue refuses every tool that could
// change the computer or leave it. A release reads the code it was built
// from (its version's tag on GitHub); a build from a checkout reads that
// checkout. The repo's .trissue.json says how the issue is written and
// where it can go.
import * as path from "path";
import { app, clipboard, shell, type WebContents } from "electron";
import {
    StoppedError,
    Transcript,
    buildLink,
    buildPrompt,
    chooseModel,
    detectHarnesses,
    fetchSource,
    fileGitHubIssue,
    formatIssue,
    gitHubStatus,
    knownHarnesses,
    linkIncludesIssue,
    parseConfig,
    parseIssue,
    resolveSource,
    startAgent,
    type AgentSession,
    type FetchedSource,
    type Issue,
    type TrissueConfig,
} from "trissue-embedded";
import rawConfig from "../../../../.trissue.json";
import type { CallAnswer, CallArgs, IssueGitHub } from "../shared/shellContract";
import { pushToWindow } from "./communication/shellPush";
import { fetchReleaseSource, unpackAsarHarness } from "./issueReportSource";

// a report is one investigation; a window has at most one going, and
// keeps the issue the last one wrote until it sends it
interface Report {
    id: string;
    abort: AbortController;
    session: AgentSession | null;
    stopped: boolean;
    issue: Issue | null;
}

const reports = new Map<number, Report>();
// the windows whose going away is watched, each once
const watched = new Set<number>();

let parsed: TrissueConfig | null = null;
function config(): TrissueConfig {
    parsed ??= parseConfig(rawConfig);
    return parsed;
}

function stop(report: Report): void {
    report.stopped = true;
    report.abort.abort();
    report.session?.stop();
}

// a window that closes or loads again has no one left to show the report to
function track(wc: WebContents, report: Report): void {
    const id = wc.id;
    const previous = reports.get(id);
    if (previous) stop(previous);
    reports.set(id, report);
    if (watched.has(id)) return;
    watched.add(id);
    const forget = () => {
        const current = reports.get(id);
        if (current) stop(current);
        reports.delete(id);
    };
    wc.on("did-navigate", forget);
    wc.once("destroyed", () => {
        forget();
        watched.delete(id);
    });
}

function reportOf(wc: WebContents, reportId: string): Report {
    const report = reports.get(wc.id);
    if (!report || report.id !== reportId) throw new Error("That report is over. Start a new one.");
    return report;
}

function writtenIssue(wc: WebContents, reportId: string): Issue {
    const issue = reportOf(wc, reportId).issue;
    if (!issue) throw new Error("The issue isn't written yet.");
    return issue;
}

/** the code to read: this checkout, or the release's tag tarball from GitHub (no git needed) */
async function fetchCodeSource(signal: AbortSignal): Promise<FetchedSource> {
    if (!app.isPackaged) return fetchSource(await resolveSource(path.resolve(app.getAppPath(), "../..")));
    const repo = config().github;
    if (!repo) throw new Error("Paperboard's trissue config names no GitHub repository to read.");
    return fetchReleaseSource(repo, `v${app.getVersion()}`, { signal });
}

async function gitHub(): Promise<IssueGitHub> {
    const repo = config().github;
    if (!repo) return null;
    try {
        const status = await gitHubStatus();
        return status.state === "signed-in" ? { repo, state: status.state, login: status.login } : { repo, state: status.state };
    } catch (err) {
        // quiet: shown on the GitHub destination so a gh check failure never discards the written issue
        return { repo, state: "error", error: err instanceof Error ? err.message : String(err) };
    }
}

// what an agent is called in the picker where trissue's name is longer than people say it
const SHORT_NAMES: Record<string, string> = { claude: "Claude" };
const pickerName = (agent: { id: string; name: string }) => SHORT_NAMES[agent.id] ?? agent.name;

export function issueReportSetup(): CallAnswer<"issue-report-setup"> {
    const { prompt, links } = config();
    return {
        prompt: prompt ?? "What went wrong?",
        agents: detectHarnesses().map((agent) => ({ id: agent.id, name: pickerName(agent) })),
        known: knownHarnesses()
            .filter((agent) => agent.branded)
            .map((agent) => agent.name),
        links: (links ?? []).map((link) => ({
            label: link.label,
            description: link.description,
            includesIssue: linkIncludesIssue(link),
        })),
    };
}

export async function startIssueReport(wc: WebContents, { reportId, description, agent }: CallArgs<"issue-report-start">): Promise<CallAnswer<"issue-report-start">> {
    const found = detectHarnesses().find((candidate) => candidate.id === agent);
    if (!found) throw new Error(`${agent} isn't installed on this computer anymore.`);
    const harness = unpackAsarHarness(found, app.isPackaged);
    const report: Report = { id: reportId, abort: new AbortController(), session: null, stopped: false, issue: null };
    track(wc, report);

    const transcript = new Transcript();
    let source: FetchedSource | null = null;
    try {
        source = await fetchCodeSource(report.abort.signal);
        if (report.stopped) return { status: "stopped" };
        if (!wc.isDestroyed()) {
            pushToWindow(wc, "issue-report-entry", {
                reportId,
                id: "paperboard-start",
                kind: "notice",
                text: `Starting ${pickerName(harness)}...`,
            });
        }
        const session = await startAgent({
            harness,
            cwd: source.dir,
            onEvent: (event) => {
                const entry = transcript.apply(event);
                if (!wc.isDestroyed()) pushToWindow(wc, "issue-report-entry", { reportId, ...entry });
            },
        });
        report.session = session;
        try {
            // stopped while the agent started: it never runs
            if (report.stopped) return { status: "stopped" };
            const model = await chooseModel(session, config());
            const text = await session.run(
                buildPrompt({
                    issue: description,
                    source,
                    instructions: config().instructions,
                    harnessName: harness.name,
                    modelName: session.models.find((option) => option.id === model)?.name ?? model,
                }),
            );
            const issue = parseIssue(text);
            report.issue = issue;
            return { status: "written", title: issue.title, body: issue.body, text: formatIssue(issue), github: await gitHub() };
        } finally {
            session.close();
        }
    } catch (err) {
        if (err instanceof StoppedError || report.stopped) return { status: "stopped" };
        throw err;
    } finally {
        if (source) await source.dispose();
    }
}

export function steerIssueReport(wc: WebContents, { reportId, text }: CallArgs<"issue-report-steer">): void {
    const session = reportOf(wc, reportId).session;
    if (!session) throw new Error("The agent hasn't started yet. Try again in a moment.");
    session.steer(text);
}

// stopping a report that is already over has nothing left to stop
export function stopIssueReport(wc: WebContents, { reportId }: CallArgs<"issue-report-stop">): void {
    const report = reports.get(wc.id);
    if (report && report.id === reportId) stop(report);
}

export function fileIssueReport(wc: WebContents, { reportId }: CallArgs<"issue-report-file">): Promise<string> {
    const issue = writtenIssue(wc, reportId);
    const { github, labels } = config();
    if (!github) throw new Error("Paperboard's trissue config files no GitHub issues.");
    return fileGitHubIssue(github, issue, labels);
}

export async function openIssueReportLink(wc: WebContents, { reportId, index }: CallArgs<"issue-report-open-link">): Promise<void> {
    const issue = writtenIssue(wc, reportId);
    const link = config().links?.[index];
    if (!link) throw new Error(`Paperboard's trissue config has no link ${index}.`);
    // a link without {title}/{body}/{issue} (like a Discord invite) carries no
    // text of its own, so put the issue on the clipboard ready to paste
    if (!linkIncludesIssue(link)) clipboard.writeText(formatIssue(issue));
    await shell.openExternal(buildLink(link, issue));
}
